var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../scripts/woff2/woff2-vite-plugins.js
var require_woff2_vite_plugins = __commonJS({
  "../scripts/woff2/woff2-vite-plugins.js"(exports, module) {
    "use strict";
    var OSS_FONTS_CDN = "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/";
    var OSS_FONTS_FALLBACK = "/";
    module.exports.woff2BrowserPlugin = () => {
      let isDev;
      return {
        name: "woff2BrowserPlugin",
        enforce: "pre",
        config(_, { command }) {
          isDev = command === "serve";
        },
        transform(code, id) {
          if (!isDev && id.endsWith("/excalidraw/fonts/fonts.css")) {
            return `/* WARN: The following content is generated during excalidraw-app build */

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-Regular.woff2)
            format("woff2"),
          url(./Assistant-Regular.woff2) format("woff2");
        font-weight: 400;
        style: normal;
        display: swap;
      }

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-Medium.woff2)
            format("woff2"),
          url(./Assistant-Medium.woff2) format("woff2");
        font-weight: 500;
        style: normal;
        display: swap;
      }

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-SemiBold.woff2)
            format("woff2"),
          url(./Assistant-SemiBold.woff2) format("woff2");
        font-weight: 600;
        style: normal;
        display: swap;
      }

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-Bold.woff2)
            format("woff2"),
          url(./Assistant-Bold.woff2) format("woff2");
        font-weight: 700;
        style: normal;
        display: swap;
      }`;
          }
          if (!isDev && id.endsWith("excalidraw-app/index.html")) {
            return code.replace(
              "<!-- PLACEHOLDER:EXCALIDRAW_APP_FONTS -->",
              `<script>
        // point into our CDN in prod, fallback to root (excalidraw.com) domain in case of issues
        window.EXCALIDRAW_ASSET_PATH = [
          "${OSS_FONTS_CDN}",
          "${OSS_FONTS_FALLBACK}",
        ];
      </script>

      <!-- Preload all default fonts to avoid swap on init -->
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <!-- For Nunito only preload the latin range, which should be good enough for now -->
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgeg.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/ComicShanns/ComicShanns-Regular-279a7b317d12eb88de06167bd672b4b4.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
    `
            );
          }
        }
      };
    };
  }
});

// vite.config.mts
var import_woff2_vite_plugins = __toESM(require_woff2_vite_plugins(), 1);
import path from "path";
import { Buffer as Buffer2 } from "node:buffer";
import { defineConfig, loadEnv } from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite/dist/node/index.js";
import react from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/@vitejs/plugin-react/dist/index.mjs";
import svgrPlugin from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite-plugin-svgr/dist/index.js";
import { ViteEjsPlugin } from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite-plugin-ejs/index.js";
import { VitePWA } from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite-plugin-pwa/dist/index.js";
import checker from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite-plugin-checker/dist/esm/main.js";
import { createHtmlPlugin } from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite-plugin-html/dist/index.mjs";
import Sitemap from "file:///F:/Projects/Aim_Projects/aifaBoardExcali/aifaboard/node_modules/vite-plugin-sitemap/dist/index.js";
var __vite_injected_original_dirname = "F:\\Projects\\Aim_Projects\\aifaBoardExcali\\aifaboard\\excalidraw-app";
var workspaceRoot = path.resolve(__vite_injected_original_dirname, "..");
var vite_config_default = defineConfig(({ mode }) => {
  const envRoot = loadEnv(mode, workspaceRoot, "");
  const envApp = loadEnv(mode, __vite_injected_original_dirname, "");
  const envVars = { ...envRoot, ...envApp };
  const importMetaEnvDefine = Object.fromEntries(
    Object.entries(envVars).filter(([key]) => key.startsWith("VITE_")).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value ?? "")
    ])
  );
  return {
    define: importMetaEnvDefine,
    server: {
      port: Number(envVars.VITE_APP_PORT || 3e3),
      // open the browser
      open: true
    },
    // We need to specify the envDir since now there are no
    //more located in parallel with the vite.config.ts file but in parent dir
    envDir: "../",
    resolve: {
      // Monorepo + Vite can resolve two copies of React → "Invalid hook call" in Jotai Provider etc.
      dedupe: ["react", "react-dom"],
      alias: [
        {
          find: "react",
          replacement: path.join(workspaceRoot, "node_modules/react")
        },
        {
          find: "react-dom",
          replacement: path.join(workspaceRoot, "node_modules/react-dom")
        },
        {
          find: /^@excalidraw\/common$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/common/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/common\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/common/src/$1")
        },
        {
          find: /^@excalidraw\/element$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/element/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/element\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/element/src/$1")
        },
        {
          find: /^@excalidraw\/excalidraw$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/excalidraw/index.tsx"
          )
        },
        {
          find: /^@excalidraw\/excalidraw\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/excalidraw/$1")
        },
        {
          find: /^@excalidraw\/math$/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/math/src/index.ts")
        },
        {
          find: /^@excalidraw\/math\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/math/src/$1")
        },
        {
          find: /^@excalidraw\/utils$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/utils/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/utils\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/utils/src/$1")
        }
      ]
    },
    build: {
      outDir: "build",
      rollupOptions: {
        output: {
          assetFileNames(chunkInfo) {
            if (chunkInfo?.name?.endsWith(".woff2")) {
              const family = chunkInfo.name.split("-")[0];
              return `fonts/${family}/[name][extname]`;
            }
            return "assets/[name]-[hash][extname]";
          },
          // Creating separate chunk for locales except for en and percentages.json so they
          // can be cached at runtime and not merged with
          // app precache. en.json and percentages.json are needed for first load
          // or fallback hence not clubbing with locales so first load followed by offline mode works fine. This is how CRA used to work too.
          manualChunks(id) {
            if (id.includes("packages/excalidraw/locales") && id.match(/en.json|percentages.json/) === null) {
              const index = id.indexOf("locales/");
              return `locales/${id.substring(index + 8)}`;
            }
            if (id.includes("@excalidraw/mermaid-to-excalidraw")) {
              return "mermaid-to-excalidraw";
            }
            if (id.includes("@codemirror/") || id.includes("@lezer/")) {
              return "codemirror.chunk";
            }
          }
        }
      },
      sourcemap: true,
      // don't auto-inline small assets (i.e. fonts hosted on CDN)
      assetsInlineLimit: 0
    },
    plugins: [
      /**
       * Clerk must receive a non-empty publishableKey. Some dev setups fail to
       * replace `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY` everywhere; a meta
       * tag is a reliable second source (publishable keys are public).
       */
      {
        name: "aimtutor-clerk-publishable-meta",
        transformIndexHtml(html) {
          const pk = (envVars.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
          if (!pk) {
            return html;
          }
          const b64 = Buffer2.from(pk, "utf8").toString("base64");
          const inject = `
    <meta name="aimtutor-clerk-pk" content="${b64}" />
`;
          return html.replace(/<head>/i, `<head>${inject}`);
        }
      },
      Sitemap({
        hostname: "https://aimtutor.ai",
        outDir: "build",
        changefreq: "monthly",
        // its static in public folder
        generateRobotsTxt: false
      }),
      (0, import_woff2_vite_plugins.woff2BrowserPlugin)(),
      react(),
      checker({
        typescript: true,
        eslint: envVars.VITE_APP_ENABLE_ESLINT === "false" ? void 0 : { lintCommand: 'eslint "./**/*.{js,ts,tsx}"' },
        overlay: {
          initialIsOpen: envVars.VITE_APP_COLLAPSE_OVERLAY === "false",
          badgeStyle: "margin-bottom: 4rem; margin-left: 1rem"
        }
      }),
      svgrPlugin(),
      ViteEjsPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          /* set this flag to true to enable in Development mode */
          enabled: envVars.VITE_APP_ENABLE_PWA === "true"
        },
        workbox: {
          // don't precache fonts, locales and separate chunks
          globIgnores: [
            "fonts.css",
            "**/locales/**",
            "service-worker.js",
            "**/*.chunk-*.js",
            // CodeMirrorEditor can't be assigned a `.chunk` name via
            // manualChunks because Rollup would hoist shared deps (React)
            // via a static import from the main bundle, defeating lazy
            // loading. So we exclude it by name instead.
            "**/CodeMirrorEditor-*.js"
          ],
          runtimeCaching: [
            {
              urlPattern: new RegExp(".+.woff2"),
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 1e3,
                  maxAgeSeconds: 60 * 60 * 24 * 90
                  // 90 days
                },
                cacheableResponse: {
                  // 0 to cache "opaque" responses from cross-origin requests (i.e. CDN)
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: new RegExp("fonts.css"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50
                }
              }
            },
            {
              urlPattern: new RegExp("locales/[^/]+.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "locales",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                  // <== 30 days
                }
              }
            },
            {
              urlPattern: new RegExp("(.chunk-.+|CodeMirrorEditor-.+)\\.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "chunk",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 90
                  // <== 90 days
                }
              }
            }
          ],
          // Default Workbox limit is 2 MiB; main index chunk can exceed that as the app grows.
          maximumFileSizeToCacheInBytes: 5 * 1024 ** 2
        },
        manifest: {
          short_name: "aimtutor.ai",
          name: "aimtutor.ai",
          description: "aimtutor.ai is a whiteboard tool that lets you easily sketch diagrams that have a hand-drawn feel to them.",
          icons: [
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png"
            },
            {
              src: "apple-touch-icon.png",
              type: "image/png",
              sizes: "180x180"
            },
            {
              src: "favicon-32x32.png",
              sizes: "32x32",
              type: "image/png"
            },
            {
              src: "favicon-16x16.png",
              sizes: "16x16",
              type: "image/png"
            }
          ],
          start_url: "/",
          id: "aimtutor-ai",
          display: "standalone",
          theme_color: "#121212",
          background_color: "#ffffff",
          file_handlers: [
            {
              action: "/",
              accept: {
                "application/vnd.excalidraw+json": [".excalidraw"]
              }
            }
          ],
          share_target: {
            action: "/web-share-target",
            method: "POST",
            enctype: "multipart/form-data",
            params: {
              files: [
                {
                  name: "file",
                  accept: [
                    "application/vnd.excalidraw+json",
                    "application/json",
                    ".excalidraw"
                  ]
                }
              ]
            }
          },
          screenshots: [
            {
              src: "/screenshots/virtual-whiteboard.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/wireframe.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/illustration.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/shapes.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/collaboration.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/export.png",
              type: "image/png",
              sizes: "462x945"
            }
          ]
        }
      }),
      createHtmlPlugin({
        minify: true
      })
    ],
    publicDir: "../public",
    optimizeDeps: {
      include: ["react", "react-dom", "jotai"]
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2NyaXB0cy93b2ZmMi93b2ZmMi12aXRlLXBsdWdpbnMuanMiLCAidml0ZS5jb25maWcubXRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRjpcXFxcUHJvamVjdHNcXFxcQWltX1Byb2plY3RzXFxcXGFpZmFCb2FyZEV4Y2FsaVxcXFxhaWZhYm9hcmRcXFxcc2NyaXB0c1xcXFx3b2ZmMlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRjpcXFxcUHJvamVjdHNcXFxcQWltX1Byb2plY3RzXFxcXGFpZmFCb2FyZEV4Y2FsaVxcXFxhaWZhYm9hcmRcXFxcc2NyaXB0c1xcXFx3b2ZmMlxcXFx3b2ZmMi12aXRlLXBsdWdpbnMuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Y6L1Byb2plY3RzL0FpbV9Qcm9qZWN0cy9haWZhQm9hcmRFeGNhbGkvYWlmYWJvYXJkL3NjcmlwdHMvd29mZjIvd29mZjItdml0ZS1wbHVnaW5zLmpzXCI7Ly8gZGVmaW5lIGBFWENBTElEUkFXX0FTU0VUX1BBVEhgIGFzIGEgU1NPVFxuY29uc3QgT1NTX0ZPTlRTX0NETiA9IFwiaHR0cHM6Ly9leGNhbGlkcmF3Lm55YzMuY2RuLmRpZ2l0YWxvY2VhbnNwYWNlcy5jb20vb3NzL1wiO1xuY29uc3QgT1NTX0ZPTlRTX0ZBTExCQUNLID0gXCIvXCI7XG5cbi8qKlxuICogQ3VzdG9tIHZpdGUgcGx1Z2luIGZvciBhdXRvLXByZWZpeGluZyBgRVhDQUxJRFJBV19BU1NFVF9QQVRIYCB3b2ZmMiBmb250cyBpbiBgZXhjYWxpZHJhdy1hcHBgLlxuICpcbiAqIEByZXR1cm5zIHtpbXBvcnQoXCJ2aXRlXCIpLlBsdWdpbk9wdGlvbn1cbiAqL1xubW9kdWxlLmV4cG9ydHMud29mZjJCcm93c2VyUGx1Z2luID0gKCkgPT4ge1xuICBsZXQgaXNEZXY7XG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBcIndvZmYyQnJvd3NlclBsdWdpblwiLFxuICAgIGVuZm9yY2U6IFwicHJlXCIsXG4gICAgY29uZmlnKF8sIHsgY29tbWFuZCB9KSB7XG4gICAgICBpc0RldiA9IGNvbW1hbmQgPT09IFwic2VydmVcIjtcbiAgICB9LFxuICAgIHRyYW5zZm9ybShjb2RlLCBpZCkge1xuICAgICAgLy8gdXNpbmcgY29weSAvIHJlcGxhY2UgYXMgZm9udHMgZGVmaW5lZCBpbiB0aGUgYC5jc3NgIGRvbid0IGhhdmUgdG8gYmUgbWFudWFsbHkgY29waWVkIG92ZXIgKHZpdGUvcm9sbHVwIGRvZXMgdGhpcyBhdXRvbWF0aWNhbGx5KSxcbiAgICAgIC8vIGJ1dCBhdCB0aGUgc2FtZSB0aW1lIGNhbid0IGJlIGVhc2lseSBwcmVmaXhlZCB3aXRoIHRoZSBgRVhDQUxJRFJBV19BU1NFVF9QQVRIYCBvbmx5IGZvciB0aGUgYGV4Y2FsaWRyYXctYXBwYFxuICAgICAgaWYgKCFpc0RldiAmJiBpZC5lbmRzV2l0aChcIi9leGNhbGlkcmF3L2ZvbnRzL2ZvbnRzLmNzc1wiKSkge1xuICAgICAgICByZXR1cm4gYC8qIFdBUk46IFRoZSBmb2xsb3dpbmcgY29udGVudCBpcyBnZW5lcmF0ZWQgZHVyaW5nIGV4Y2FsaWRyYXctYXBwIGJ1aWxkICovXG5cbiAgICAgIEBmb250LWZhY2Uge1xuICAgICAgICBmb250LWZhbWlseTogXCJBc3Npc3RhbnRcIjtcbiAgICAgICAgc3JjOiB1cmwoJHtPU1NfRk9OVFNfQ0ROfWZvbnRzL0Fzc2lzdGFudC9Bc3Npc3RhbnQtUmVndWxhci53b2ZmMilcbiAgICAgICAgICAgIGZvcm1hdChcIndvZmYyXCIpLFxuICAgICAgICAgIHVybCguL0Fzc2lzdGFudC1SZWd1bGFyLndvZmYyKSBmb3JtYXQoXCJ3b2ZmMlwiKTtcbiAgICAgICAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgICAgICAgc3R5bGU6IG5vcm1hbDtcbiAgICAgICAgZGlzcGxheTogc3dhcDtcbiAgICAgIH1cblxuICAgICAgQGZvbnQtZmFjZSB7XG4gICAgICAgIGZvbnQtZmFtaWx5OiBcIkFzc2lzdGFudFwiO1xuICAgICAgICBzcmM6IHVybCgke09TU19GT05UU19DRE59Zm9udHMvQXNzaXN0YW50L0Fzc2lzdGFudC1NZWRpdW0ud29mZjIpXG4gICAgICAgICAgICBmb3JtYXQoXCJ3b2ZmMlwiKSxcbiAgICAgICAgICB1cmwoLi9Bc3Npc3RhbnQtTWVkaXVtLndvZmYyKSBmb3JtYXQoXCJ3b2ZmMlwiKTtcbiAgICAgICAgZm9udC13ZWlnaHQ6IDUwMDtcbiAgICAgICAgc3R5bGU6IG5vcm1hbDtcbiAgICAgICAgZGlzcGxheTogc3dhcDtcbiAgICAgIH1cblxuICAgICAgQGZvbnQtZmFjZSB7XG4gICAgICAgIGZvbnQtZmFtaWx5OiBcIkFzc2lzdGFudFwiO1xuICAgICAgICBzcmM6IHVybCgke09TU19GT05UU19DRE59Zm9udHMvQXNzaXN0YW50L0Fzc2lzdGFudC1TZW1pQm9sZC53b2ZmMilcbiAgICAgICAgICAgIGZvcm1hdChcIndvZmYyXCIpLFxuICAgICAgICAgIHVybCguL0Fzc2lzdGFudC1TZW1pQm9sZC53b2ZmMikgZm9ybWF0KFwid29mZjJcIik7XG4gICAgICAgIGZvbnQtd2VpZ2h0OiA2MDA7XG4gICAgICAgIHN0eWxlOiBub3JtYWw7XG4gICAgICAgIGRpc3BsYXk6IHN3YXA7XG4gICAgICB9XG5cbiAgICAgIEBmb250LWZhY2Uge1xuICAgICAgICBmb250LWZhbWlseTogXCJBc3Npc3RhbnRcIjtcbiAgICAgICAgc3JjOiB1cmwoJHtPU1NfRk9OVFNfQ0ROfWZvbnRzL0Fzc2lzdGFudC9Bc3Npc3RhbnQtQm9sZC53b2ZmMilcbiAgICAgICAgICAgIGZvcm1hdChcIndvZmYyXCIpLFxuICAgICAgICAgIHVybCguL0Fzc2lzdGFudC1Cb2xkLndvZmYyKSBmb3JtYXQoXCJ3b2ZmMlwiKTtcbiAgICAgICAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgICAgICAgc3R5bGU6IG5vcm1hbDtcbiAgICAgICAgZGlzcGxheTogc3dhcDtcbiAgICAgIH1gO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWlzRGV2ICYmIGlkLmVuZHNXaXRoKFwiZXhjYWxpZHJhdy1hcHAvaW5kZXguaHRtbFwiKSkge1xuICAgICAgICByZXR1cm4gY29kZS5yZXBsYWNlKFxuICAgICAgICAgIFwiPCEtLSBQTEFDRUhPTERFUjpFWENBTElEUkFXX0FQUF9GT05UUyAtLT5cIixcbiAgICAgICAgICBgPHNjcmlwdD5cbiAgICAgICAgLy8gcG9pbnQgaW50byBvdXIgQ0ROIGluIHByb2QsIGZhbGxiYWNrIHRvIHJvb3QgKGV4Y2FsaWRyYXcuY29tKSBkb21haW4gaW4gY2FzZSBvZiBpc3N1ZXNcbiAgICAgICAgd2luZG93LkVYQ0FMSURSQVdfQVNTRVRfUEFUSCA9IFtcbiAgICAgICAgICBcIiR7T1NTX0ZPTlRTX0NETn1cIixcbiAgICAgICAgICBcIiR7T1NTX0ZPTlRTX0ZBTExCQUNLfVwiLFxuICAgICAgICBdO1xuICAgICAgPC9zY3JpcHQ+XG5cbiAgICAgIDwhLS0gUHJlbG9hZCBhbGwgZGVmYXVsdCBmb250cyB0byBhdm9pZCBzd2FwIG9uIGluaXQgLS0+XG4gICAgICA8bGlua1xuICAgICAgICByZWw9XCJwcmVsb2FkXCJcbiAgICAgICAgaHJlZj1cIiR7T1NTX0ZPTlRTX0NETn1mb250cy9FeGNhbGlmb250L0V4Y2FsaWZvbnQtUmVndWxhci1hODhiNzJhMjRmYjU0YzlmOTRlM2I1ZmRhYTc0ODFjOS53b2ZmMlwiXG4gICAgICAgIGFzPVwiZm9udFwiXG4gICAgICAgIHR5cGU9XCJmb250L3dvZmYyXCJcbiAgICAgICAgY3Jvc3NvcmlnaW49XCJhbm9ueW1vdXNcIlxuICAgICAgLz5cbiAgICAgIDwhLS0gRm9yIE51bml0byBvbmx5IHByZWxvYWQgdGhlIGxhdGluIHJhbmdlLCB3aGljaCBzaG91bGQgYmUgZ29vZCBlbm91Z2ggZm9yIG5vdyAtLT5cbiAgICAgIDxsaW5rXG4gICAgICAgIHJlbD1cInByZWxvYWRcIlxuICAgICAgICBocmVmPVwiJHtPU1NfRk9OVFNfQ0ROfWZvbnRzL051bml0by9OdW5pdG8tUmVndWxhci1YUlhJM0k2TGkwMUJLb2ZpT2M1d3RsWjJkaThIRElraGRUUTNqNnpiWFdqZ2VnLndvZmYyXCJcbiAgICAgICAgYXM9XCJmb250XCJcbiAgICAgICAgdHlwZT1cImZvbnQvd29mZjJcIlxuICAgICAgICBjcm9zc29yaWdpbj1cImFub255bW91c1wiXG4gICAgICAvPlxuICAgICAgPGxpbmtcbiAgICAgICAgcmVsPVwicHJlbG9hZFwiXG4gICAgICAgIGhyZWY9XCIke09TU19GT05UU19DRE59Zm9udHMvQ29taWNTaGFubnMvQ29taWNTaGFubnMtUmVndWxhci0yNzlhN2IzMTdkMTJlYjg4ZGUwNjE2N2JkNjcyYjRiNC53b2ZmMlwiXG4gICAgICAgIGFzPVwiZm9udFwiXG4gICAgICAgIHR5cGU9XCJmb250L3dvZmYyXCJcbiAgICAgICAgY3Jvc3NvcmlnaW49XCJhbm9ueW1vdXNcIlxuICAgICAgLz5cbiAgICBgLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59O1xuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJGOlxcXFxQcm9qZWN0c1xcXFxBaW1fUHJvamVjdHNcXFxcYWlmYUJvYXJkRXhjYWxpXFxcXGFpZmFib2FyZFxcXFxleGNhbGlkcmF3LWFwcFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRjpcXFxcUHJvamVjdHNcXFxcQWltX1Byb2plY3RzXFxcXGFpZmFCb2FyZEV4Y2FsaVxcXFxhaWZhYm9hcmRcXFxcZXhjYWxpZHJhdy1hcHBcXFxcdml0ZS5jb25maWcubXRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9GOi9Qcm9qZWN0cy9BaW1fUHJvamVjdHMvYWlmYUJvYXJkRXhjYWxpL2FpZmFib2FyZC9leGNhbGlkcmF3LWFwcC92aXRlLmNvbmZpZy5tdHNcIjtpbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgQnVmZmVyIH0gZnJvbSBcIm5vZGU6YnVmZmVyXCI7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHN2Z3JQbHVnaW4gZnJvbSBcInZpdGUtcGx1Z2luLXN2Z3JcIjtcbmltcG9ydCB7IFZpdGVFanNQbHVnaW4gfSBmcm9tIFwidml0ZS1wbHVnaW4tZWpzXCI7XG5pbXBvcnQgeyBWaXRlUFdBIH0gZnJvbSBcInZpdGUtcGx1Z2luLXB3YVwiO1xuaW1wb3J0IGNoZWNrZXIgZnJvbSBcInZpdGUtcGx1Z2luLWNoZWNrZXJcIjtcbmltcG9ydCB7IGNyZWF0ZUh0bWxQbHVnaW4gfSBmcm9tIFwidml0ZS1wbHVnaW4taHRtbFwiO1xuaW1wb3J0IFNpdGVtYXAgZnJvbSBcInZpdGUtcGx1Z2luLXNpdGVtYXBcIjtcbmltcG9ydCB7IHdvZmYyQnJvd3NlclBsdWdpbiB9IGZyb20gXCIuLi9zY3JpcHRzL3dvZmYyL3dvZmYyLXZpdGUtcGx1Z2luc1wiO1xuXG4vKiogWWFybiB3b3Jrc3BhY2Ugcm9vdCAocGFyZW50IG9mIGV4Y2FsaWRyYXctYXBwLykuIFVzZWQgdG8gcGluIGEgc2luZ2xlIFJlYWN0IGNvcHkuICovXG5jb25zdCB3b3Jrc3BhY2VSb290ID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLlwiKTtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xuICAvLyBMb2FkIGAuZW52KmAgZnJvbSBtb25vcmVwbyByb290IChwcmltYXJ5KSBhbmQgZnJvbSBgZXhjYWxpZHJhdy1hcHAvYCAob3ZlcnJpZGVzKS5cbiAgLy8gYGVudkRpcmAgYmVsb3cgb25seSBwb2ludHMgYXQgdGhlIHJvb3QsIHNvIHdpdGhvdXQgdGhpcyBtZXJnZSwgdmFyaWFibGVzIHRoYXRcbiAgLy8gZXhpc3Qgb25seSB1bmRlciBgZXhjYWxpZHJhdy1hcHAvLmVudipgIHdvdWxkIG5ldmVyIHJlYWNoIGBpbXBvcnQubWV0YS5lbnYuVklURV8qYC5cbiAgY29uc3QgZW52Um9vdCA9IGxvYWRFbnYobW9kZSwgd29ya3NwYWNlUm9vdCwgXCJcIik7XG4gIGNvbnN0IGVudkFwcCA9IGxvYWRFbnYobW9kZSwgX19kaXJuYW1lLCBcIlwiKTtcbiAgY29uc3QgZW52VmFycyA9IHsgLi4uZW52Um9vdCwgLi4uZW52QXBwIH07XG5cbiAgY29uc3QgaW1wb3J0TWV0YUVudkRlZmluZSA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhlbnZWYXJzKVxuICAgICAgLmZpbHRlcigoW2tleV0pID0+IGtleS5zdGFydHNXaXRoKFwiVklURV9cIikpXG4gICAgICAubWFwKChba2V5LCB2YWx1ZV0pID0+IFtcbiAgICAgICAgYGltcG9ydC5tZXRhLmVudi4ke2tleX1gLFxuICAgICAgICBKU09OLnN0cmluZ2lmeSh2YWx1ZSA/PyBcIlwiKSxcbiAgICAgIF0pLFxuICApO1xuXG4gIC8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG4gIHJldHVybiB7XG4gICAgZGVmaW5lOiBpbXBvcnRNZXRhRW52RGVmaW5lLFxuICAgIHNlcnZlcjoge1xuICAgICAgcG9ydDogTnVtYmVyKGVudlZhcnMuVklURV9BUFBfUE9SVCB8fCAzMDAwKSxcbiAgICAgIC8vIG9wZW4gdGhlIGJyb3dzZXJcbiAgICAgIG9wZW46IHRydWUsXG4gICAgfSxcbiAgICAvLyBXZSBuZWVkIHRvIHNwZWNpZnkgdGhlIGVudkRpciBzaW5jZSBub3cgdGhlcmUgYXJlIG5vXG4gICAgLy9tb3JlIGxvY2F0ZWQgaW4gcGFyYWxsZWwgd2l0aCB0aGUgdml0ZS5jb25maWcudHMgZmlsZSBidXQgaW4gcGFyZW50IGRpclxuICAgIGVudkRpcjogXCIuLi9cIixcbiAgICByZXNvbHZlOiB7XG4gICAgICAvLyBNb25vcmVwbyArIFZpdGUgY2FuIHJlc29sdmUgdHdvIGNvcGllcyBvZiBSZWFjdCBcdTIxOTIgXCJJbnZhbGlkIGhvb2sgY2FsbFwiIGluIEpvdGFpIFByb3ZpZGVyIGV0Yy5cbiAgICAgIGRlZHVwZTogW1wicmVhY3RcIiwgXCJyZWFjdC1kb21cIl0sXG4gICAgICBhbGlhczogW1xuICAgICAgICB7XG4gICAgICAgICAgZmluZDogXCJyZWFjdFwiLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLmpvaW4od29ya3NwYWNlUm9vdCwgXCJub2RlX21vZHVsZXMvcmVhY3RcIiksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiBcInJlYWN0LWRvbVwiLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLmpvaW4od29ya3NwYWNlUm9vdCwgXCJub2RlX21vZHVsZXMvcmVhY3QtZG9tXCIpLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL2NvbW1vbiQvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoXG4gICAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgICBcIi4uL3BhY2thZ2VzL2NvbW1vbi9zcmMvaW5kZXgudHNcIixcbiAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL2NvbW1vblxcLyguKj8pLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi9wYWNrYWdlcy9jb21tb24vc3JjLyQxXCIpLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL2VsZW1lbnQkLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKFxuICAgICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgICAgXCIuLi9wYWNrYWdlcy9lbGVtZW50L3NyYy9pbmRleC50c1wiLFxuICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvZWxlbWVudFxcLyguKj8pLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi9wYWNrYWdlcy9lbGVtZW50L3NyYy8kMVwiKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC9leGNhbGlkcmF3JC8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShcbiAgICAgICAgICAgIF9fZGlybmFtZSxcbiAgICAgICAgICAgIFwiLi4vcGFja2FnZXMvZXhjYWxpZHJhdy9pbmRleC50c3hcIixcbiAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL2V4Y2FsaWRyYXdcXC8oLio/KS8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vcGFja2FnZXMvZXhjYWxpZHJhdy8kMVwiKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC9tYXRoJC8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vcGFja2FnZXMvbWF0aC9zcmMvaW5kZXgudHNcIiksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvbWF0aFxcLyguKj8pLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi9wYWNrYWdlcy9tYXRoL3NyYy8kMVwiKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC91dGlscyQvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoXG4gICAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgICBcIi4uL3BhY2thZ2VzL3V0aWxzL3NyYy9pbmRleC50c1wiLFxuICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvdXRpbHNcXC8oLio/KS8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vcGFja2FnZXMvdXRpbHMvc3JjLyQxXCIpLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9LFxuICAgIGJ1aWxkOiB7XG4gICAgICBvdXREaXI6IFwiYnVpbGRcIixcbiAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgYXNzZXRGaWxlTmFtZXMoY2h1bmtJbmZvKSB7XG4gICAgICAgICAgICBpZiAoY2h1bmtJbmZvPy5uYW1lPy5lbmRzV2l0aChcIi53b2ZmMlwiKSkge1xuICAgICAgICAgICAgICBjb25zdCBmYW1pbHkgPSBjaHVua0luZm8ubmFtZS5zcGxpdChcIi1cIilbMF07XG4gICAgICAgICAgICAgIHJldHVybiBgZm9udHMvJHtmYW1pbHl9L1tuYW1lXVtleHRuYW1lXWA7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBcImFzc2V0cy9bbmFtZV0tW2hhc2hdW2V4dG5hbWVdXCI7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyBDcmVhdGluZyBzZXBhcmF0ZSBjaHVuayBmb3IgbG9jYWxlcyBleGNlcHQgZm9yIGVuIGFuZCBwZXJjZW50YWdlcy5qc29uIHNvIHRoZXlcbiAgICAgICAgICAvLyBjYW4gYmUgY2FjaGVkIGF0IHJ1bnRpbWUgYW5kIG5vdCBtZXJnZWQgd2l0aFxuICAgICAgICAgIC8vIGFwcCBwcmVjYWNoZS4gZW4uanNvbiBhbmQgcGVyY2VudGFnZXMuanNvbiBhcmUgbmVlZGVkIGZvciBmaXJzdCBsb2FkXG4gICAgICAgICAgLy8gb3IgZmFsbGJhY2sgaGVuY2Ugbm90IGNsdWJiaW5nIHdpdGggbG9jYWxlcyBzbyBmaXJzdCBsb2FkIGZvbGxvd2VkIGJ5IG9mZmxpbmUgbW9kZSB3b3JrcyBmaW5lLiBUaGlzIGlzIGhvdyBDUkEgdXNlZCB0byB3b3JrIHRvby5cbiAgICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoXCJwYWNrYWdlcy9leGNhbGlkcmF3L2xvY2FsZXNcIikgJiZcbiAgICAgICAgICAgICAgaWQubWF0Y2goL2VuLmpzb258cGVyY2VudGFnZXMuanNvbi8pID09PSBudWxsXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgY29uc3QgaW5kZXggPSBpZC5pbmRleE9mKFwibG9jYWxlcy9cIik7XG4gICAgICAgICAgICAgIC8vIFRha2luZyB0aGUgc3Vic3RyaW5nIGFmdGVyIFwibG9jYWxlcy9cIlxuICAgICAgICAgICAgICByZXR1cm4gYGxvY2FsZXMvJHtpZC5zdWJzdHJpbmcoaW5kZXggKyA4KX1gO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoXCJAZXhjYWxpZHJhdy9tZXJtYWlkLXRvLWV4Y2FsaWRyYXdcIikpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFwibWVybWFpZC10by1leGNhbGlkcmF3XCI7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcyhcIkBjb2RlbWlycm9yL1wiKSB8fCBpZC5pbmNsdWRlcyhcIkBsZXplci9cIikpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFwiY29kZW1pcnJvci5jaHVua1wiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgLy8gZG9uJ3QgYXV0by1pbmxpbmUgc21hbGwgYXNzZXRzIChpLmUuIGZvbnRzIGhvc3RlZCBvbiBDRE4pXG4gICAgICBhc3NldHNJbmxpbmVMaW1pdDogMCxcbiAgICB9LFxuICAgIHBsdWdpbnM6IFtcbiAgICAgIC8qKlxuICAgICAgICogQ2xlcmsgbXVzdCByZWNlaXZlIGEgbm9uLWVtcHR5IHB1Ymxpc2hhYmxlS2V5LiBTb21lIGRldiBzZXR1cHMgZmFpbCB0b1xuICAgICAgICogcmVwbGFjZSBgaW1wb3J0Lm1ldGEuZW52LlZJVEVfQ0xFUktfUFVCTElTSEFCTEVfS0VZYCBldmVyeXdoZXJlOyBhIG1ldGFcbiAgICAgICAqIHRhZyBpcyBhIHJlbGlhYmxlIHNlY29uZCBzb3VyY2UgKHB1Ymxpc2hhYmxlIGtleXMgYXJlIHB1YmxpYykuXG4gICAgICAgKi9cbiAgICAgIHtcbiAgICAgICAgbmFtZTogXCJhaW10dXRvci1jbGVyay1wdWJsaXNoYWJsZS1tZXRhXCIsXG4gICAgICAgIHRyYW5zZm9ybUluZGV4SHRtbChodG1sKSB7XG4gICAgICAgICAgY29uc3QgcGsgPSAoZW52VmFycy5WSVRFX0NMRVJLX1BVQkxJU0hBQkxFX0tFWSA/PyBcIlwiKS50cmltKCk7XG4gICAgICAgICAgaWYgKCFwaykge1xuICAgICAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGI2NCA9IEJ1ZmZlci5mcm9tKHBrLCBcInV0ZjhcIikudG9TdHJpbmcoXCJiYXNlNjRcIik7XG4gICAgICAgICAgY29uc3QgaW5qZWN0ID0gYFxcbiAgICA8bWV0YSBuYW1lPVwiYWltdHV0b3ItY2xlcmstcGtcIiBjb250ZW50PVwiJHtiNjR9XCIgLz5cXG5gO1xuICAgICAgICAgIHJldHVybiBodG1sLnJlcGxhY2UoLzxoZWFkPi9pLCBgPGhlYWQ+JHtpbmplY3R9YCk7XG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgU2l0ZW1hcCh7XG4gICAgICAgIGhvc3RuYW1lOiBcImh0dHBzOi8vYWltdHV0b3IuYWlcIixcbiAgICAgICAgb3V0RGlyOiBcImJ1aWxkXCIsXG4gICAgICAgIGNoYW5nZWZyZXE6IFwibW9udGhseVwiLFxuICAgICAgICAvLyBpdHMgc3RhdGljIGluIHB1YmxpYyBmb2xkZXJcbiAgICAgICAgZ2VuZXJhdGVSb2JvdHNUeHQ6IGZhbHNlLFxuICAgICAgfSksXG4gICAgICB3b2ZmMkJyb3dzZXJQbHVnaW4oKSxcbiAgICAgIHJlYWN0KCksXG4gICAgICBjaGVja2VyKHtcbiAgICAgICAgdHlwZXNjcmlwdDogdHJ1ZSxcbiAgICAgICAgZXNsaW50OlxuICAgICAgICAgIGVudlZhcnMuVklURV9BUFBfRU5BQkxFX0VTTElOVCA9PT0gXCJmYWxzZVwiXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgOiB7IGxpbnRDb21tYW5kOiAnZXNsaW50IFwiLi8qKi8qLntqcyx0cyx0c3h9XCInIH0sXG4gICAgICAgIG92ZXJsYXk6IHtcbiAgICAgICAgICBpbml0aWFsSXNPcGVuOiBlbnZWYXJzLlZJVEVfQVBQX0NPTExBUFNFX09WRVJMQVkgPT09IFwiZmFsc2VcIixcbiAgICAgICAgICBiYWRnZVN0eWxlOiBcIm1hcmdpbi1ib3R0b206IDRyZW07IG1hcmdpbi1sZWZ0OiAxcmVtXCIsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHN2Z3JQbHVnaW4oKSxcbiAgICAgIFZpdGVFanNQbHVnaW4oKSxcbiAgICAgIFZpdGVQV0Eoe1xuICAgICAgICByZWdpc3RlclR5cGU6IFwiYXV0b1VwZGF0ZVwiLFxuICAgICAgICBkZXZPcHRpb25zOiB7XG4gICAgICAgICAgLyogc2V0IHRoaXMgZmxhZyB0byB0cnVlIHRvIGVuYWJsZSBpbiBEZXZlbG9wbWVudCBtb2RlICovXG4gICAgICAgICAgZW5hYmxlZDogZW52VmFycy5WSVRFX0FQUF9FTkFCTEVfUFdBID09PSBcInRydWVcIixcbiAgICAgICAgfSxcblxuICAgICAgICB3b3JrYm94OiB7XG4gICAgICAgICAgLy8gZG9uJ3QgcHJlY2FjaGUgZm9udHMsIGxvY2FsZXMgYW5kIHNlcGFyYXRlIGNodW5rc1xuICAgICAgICAgIGdsb2JJZ25vcmVzOiBbXG4gICAgICAgICAgICBcImZvbnRzLmNzc1wiLFxuICAgICAgICAgICAgXCIqKi9sb2NhbGVzLyoqXCIsXG4gICAgICAgICAgICBcInNlcnZpY2Utd29ya2VyLmpzXCIsXG4gICAgICAgICAgICBcIioqLyouY2h1bmstKi5qc1wiLFxuICAgICAgICAgICAgLy8gQ29kZU1pcnJvckVkaXRvciBjYW4ndCBiZSBhc3NpZ25lZCBhIGAuY2h1bmtgIG5hbWUgdmlhXG4gICAgICAgICAgICAvLyBtYW51YWxDaHVua3MgYmVjYXVzZSBSb2xsdXAgd291bGQgaG9pc3Qgc2hhcmVkIGRlcHMgKFJlYWN0KVxuICAgICAgICAgICAgLy8gdmlhIGEgc3RhdGljIGltcG9ydCBmcm9tIHRoZSBtYWluIGJ1bmRsZSwgZGVmZWF0aW5nIGxhenlcbiAgICAgICAgICAgIC8vIGxvYWRpbmcuIFNvIHdlIGV4Y2x1ZGUgaXQgYnkgbmFtZSBpbnN0ZWFkLlxuICAgICAgICAgICAgXCIqKi9Db2RlTWlycm9yRWRpdG9yLSouanNcIixcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJ1bnRpbWVDYWNoaW5nOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHVybFBhdHRlcm46IG5ldyBSZWdFeHAoXCIuKy53b2ZmMlwiKSxcbiAgICAgICAgICAgICAgaGFuZGxlcjogXCJDYWNoZUZpcnN0XCIsXG4gICAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjYWNoZU5hbWU6IFwiZm9udHNcIixcbiAgICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICBtYXhFbnRyaWVzOiAxMDAwLFxuICAgICAgICAgICAgICAgICAgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogOTAsIC8vIDkwIGRheXNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7XG4gICAgICAgICAgICAgICAgICAvLyAwIHRvIGNhY2hlIFwib3BhcXVlXCIgcmVzcG9uc2VzIGZyb20gY3Jvc3Mtb3JpZ2luIHJlcXVlc3RzIChpLmUuIENETilcbiAgICAgICAgICAgICAgICAgIHN0YXR1c2VzOiBbMCwgMjAwXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXJsUGF0dGVybjogbmV3IFJlZ0V4cChcImZvbnRzLmNzc1wiKSxcbiAgICAgICAgICAgICAgaGFuZGxlcjogXCJTdGFsZVdoaWxlUmV2YWxpZGF0ZVwiLFxuICAgICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY2FjaGVOYW1lOiBcImZvbnRzXCIsXG4gICAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgbWF4RW50cmllczogNTAsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHVybFBhdHRlcm46IG5ldyBSZWdFeHAoXCJsb2NhbGVzL1teL10rLmpzXCIpLFxuICAgICAgICAgICAgICBoYW5kbGVyOiBcIkNhY2hlRmlyc3RcIixcbiAgICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNhY2hlTmFtZTogXCJsb2NhbGVzXCIsXG4gICAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgbWF4RW50cmllczogNTAsXG4gICAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzMCwgLy8gPD09IDMwIGRheXNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXJsUGF0dGVybjogbmV3IFJlZ0V4cChcIiguY2h1bmstLit8Q29kZU1pcnJvckVkaXRvci0uKylcXFxcLmpzXCIpLFxuICAgICAgICAgICAgICBoYW5kbGVyOiBcIkNhY2hlRmlyc3RcIixcbiAgICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNhY2hlTmFtZTogXCJjaHVua1wiLFxuICAgICAgICAgICAgICAgIGV4cGlyYXRpb246IHtcbiAgICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDUwLFxuICAgICAgICAgICAgICAgICAgbWF4QWdlU2Vjb25kczogNjAgKiA2MCAqIDI0ICogOTAsIC8vIDw9PSA5MCBkYXlzXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICAvLyBEZWZhdWx0IFdvcmtib3ggbGltaXQgaXMgMiBNaUI7IG1haW4gaW5kZXggY2h1bmsgY2FuIGV4Y2VlZCB0aGF0IGFzIHRoZSBhcHAgZ3Jvd3MuXG4gICAgICAgICAgbWF4aW11bUZpbGVTaXplVG9DYWNoZUluQnl0ZXM6IDUgKiAxMDI0ICoqIDIsXG4gICAgICAgIH0sXG4gICAgICAgIG1hbmlmZXN0OiB7XG4gICAgICAgICAgc2hvcnRfbmFtZTogXCJhaW10dXRvci5haVwiLFxuICAgICAgICAgIG5hbWU6IFwiYWltdHV0b3IuYWlcIixcbiAgICAgICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgICAgIFwiYWltdHV0b3IuYWkgaXMgYSB3aGl0ZWJvYXJkIHRvb2wgdGhhdCBsZXRzIHlvdSBlYXNpbHkgc2tldGNoIGRpYWdyYW1zIHRoYXQgaGF2ZSBhIGhhbmQtZHJhd24gZmVlbCB0byB0aGVtLlwiLFxuICAgICAgICAgIGljb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNyYzogXCJhbmRyb2lkLWNocm9tZS0xOTJ4MTkyLnBuZ1wiLFxuICAgICAgICAgICAgICBzaXplczogXCIxOTJ4MTkyXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiYXBwbGUtdG91Y2gtaWNvbi5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiMTgweDE4MFwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcImZhdmljb24tMzJ4MzIucG5nXCIsXG4gICAgICAgICAgICAgIHNpemVzOiBcIjMyeDMyXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiZmF2aWNvbi0xNngxNi5wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiMTZ4MTZcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBzdGFydF91cmw6IFwiL1wiLFxuICAgICAgICAgIGlkOiBcImFpbXR1dG9yLWFpXCIsXG4gICAgICAgICAgZGlzcGxheTogXCJzdGFuZGFsb25lXCIsXG4gICAgICAgICAgdGhlbWVfY29sb3I6IFwiIzEyMTIxMlwiLFxuICAgICAgICAgIGJhY2tncm91bmRfY29sb3I6IFwiI2ZmZmZmZlwiLFxuICAgICAgICAgIGZpbGVfaGFuZGxlcnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgYWN0aW9uOiBcIi9cIixcbiAgICAgICAgICAgICAgYWNjZXB0OiB7XG4gICAgICAgICAgICAgICAgXCJhcHBsaWNhdGlvbi92bmQuZXhjYWxpZHJhdytqc29uXCI6IFtcIi5leGNhbGlkcmF3XCJdLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHNoYXJlX3RhcmdldDoge1xuICAgICAgICAgICAgYWN0aW9uOiBcIi93ZWItc2hhcmUtdGFyZ2V0XCIsXG4gICAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgZW5jdHlwZTogXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCIsXG4gICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgZmlsZXM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBuYW1lOiBcImZpbGVcIixcbiAgICAgICAgICAgICAgICAgIGFjY2VwdDogW1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL3ZuZC5leGNhbGlkcmF3K2pzb25cIixcbiAgICAgICAgICAgICAgICAgICAgXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgICAgICAgICAgIFwiLmV4Y2FsaWRyYXdcIixcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzY3JlZW5zaG90czogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiL3NjcmVlbnNob3RzL3ZpcnR1YWwtd2hpdGVib2FyZC5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiNDYyeDk0NVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcIi9zY3JlZW5zaG90cy93aXJlZnJhbWUucG5nXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICAgIHNpemVzOiBcIjQ2Mng5NDVcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNyYzogXCIvc2NyZWVuc2hvdHMvaWxsdXN0cmF0aW9uLnBuZ1wiLFxuICAgICAgICAgICAgICB0eXBlOiBcImltYWdlL3BuZ1wiLFxuICAgICAgICAgICAgICBzaXplczogXCI0NjJ4OTQ1XCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiL3NjcmVlbnNob3RzL3NoYXBlcy5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiNDYyeDk0NVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcIi9zY3JlZW5zaG90cy9jb2xsYWJvcmF0aW9uLnBuZ1wiLFxuICAgICAgICAgICAgICB0eXBlOiBcImltYWdlL3BuZ1wiLFxuICAgICAgICAgICAgICBzaXplczogXCI0NjJ4OTQ1XCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiL3NjcmVlbnNob3RzL2V4cG9ydC5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiNDYyeDk0NVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBjcmVhdGVIdG1sUGx1Z2luKHtcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgfSksXG4gICAgXSxcbiAgICBwdWJsaWNEaXI6IFwiLi4vcHVibGljXCIsXG4gICAgb3B0aW1pemVEZXBzOiB7XG4gICAgICBpbmNsdWRlOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiLCBcImpvdGFpXCJdLFxuICAgIH0sXG4gIH07XG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7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
