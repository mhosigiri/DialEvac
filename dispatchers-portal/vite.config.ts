import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 3001,
    fs: { allow: [".."] },
    proxy: {
      "/api/outreach": {
        target: "http://127.0.0.1:8080",
        configure(proxy) {
          proxy.on("proxyReq", request => {
            const token = loadEnv(mode, "..", "").TWILIO_OUTREACH_TOKEN;
            if (token) request.setHeader("x-outreach-token", token);
          });
        },
      },
    },
  },
}));
