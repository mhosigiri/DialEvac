"""Compare raw `spacetime describe --json` outputs without relying on type-ref numbering.

Usage: python3 scripts/check_compatibility.py baseline.json candidate.json
Existing definitions must match exactly; additions must not change existing callers or rows.
"""
import json
import sys
from pathlib import Path


def sections(path):
    return {key: value for section in json.loads(Path(path).read_text())["sections"] for key, value in section.items()}


def expand(value, types):
    if isinstance(value, dict):
        if set(value) == {"Ref"}:
            return expand(types[value["Ref"]], types)
        result = {}
        for key, item in value.items():
            if key == "product_type_ref":
                result["row_type"] = expand(types[item], types)
            else:
                result[key] = expand(item, types)
            if key in {"indexes", "constraints", "sequences", "default_values"}:
                result[key] = sorted(result[key], key=lambda x: json.dumps(x, sort_keys=True))
        return result
    if isinstance(value, list):
        return [expand(item, types) for item in value]
    return value


def compare(baseline, candidate):
    old_types = baseline["Typespace"]["types"]
    new_types = candidate["Typespace"]["types"]
    assert baseline.get("CaseConversionPolicy") == candidate.get("CaseConversionPolicy"), "case conversion policy changed"
    for section in ["Tables", "Reducers", "Procedures", "Schedules", "LifeCycleReducers", "Environment"]:
        key_name = "name" if section == "Environment" else "function_name" if section == "LifeCycleReducers" else "source_name"
        key = lambda row: json.dumps(row[key_name], sort_keys=True)
        old = {key(row): expand(row, old_types) for row in baseline.get(section, [])}
        new = {key(row): expand(row, new_types) for row in candidate.get(section, [])}
        for name, row in old.items():
            assert name in new, f"removed {section}: {name}"
            assert row == new[name], f"changed {section}: {name}"
        if section == "Environment":
            for name in new.keys() - old.keys():
                assert new[name]["optional"], f"new required environment: {name}"
    old_names = baseline.get("ExplicitNames", {}).get("entries", [])
    new_names = candidate.get("ExplicitNames", {}).get("entries", [])
    canonical = lambda entry: json.dumps(entry, sort_keys=True)
    assert set(map(canonical, old_names)) <= set(map(canonical, new_names)), "existing canonical wire name changed"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    baseline, candidate = map(sections, sys.argv[1:])
    compare(baseline, candidate)
    old = {t["source_name"] for t in baseline["Tables"]}
    new = {t["source_name"] for t in candidate["Tables"]}
    print(f"Compatible: retained {len(old)} existing tables, function signatures, schedules, wire names and environment settings.")
    print("Added tables:", ", ".join(sorted(new - old)) or "none")
