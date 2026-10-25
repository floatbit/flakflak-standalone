import { defineConfig, type Plugin } from "vite";
function loader(): Plugin {
  return {
    name: "flakflak-loader",
    generateBundle(_options, bundle) {
      const runtime = Object.values(bundle).find(
        (f) => f.type === "chunk" && f.isEntry,
      );
      if (!runtime) return;
      this.emitFile({
        type: "asset",
        fileName: "widget.js",
        source: `(()=>{const current=document.currentScript;if(!current)return;const next=document.createElement('script');next.src=new URL('${runtime.fileName}',current.src).href;for(const [key,value]of Object.entries(current.dataset))next.dataset[key]=value;next.defer=true;document.head.append(next);})();`,
      });
    },
  };
}
export default defineConfig({
  plugins: [loader()],
  server: {
    port: 5174,
    strictPort: true,
    allowedHosts: ["embed-flakflak.localhost"],
  },
  build: {
    lib: {
      entry: "src/widget.ts",
      name: "FlakFlakWidget",
      formats: ["iife"],
      fileName: () => "widget-runtime.[hash].js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
