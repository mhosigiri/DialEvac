import "leaflet/dist/leaflet.css";
import "./style.css";
import { connectMap } from "./map";

const mapEl = document.getElementById("map");
if (!mapEl) throw new Error("map root missing");
connectMap(mapEl);
