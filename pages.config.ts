import { definePages } from "./vendor/pages/src/index.ts";

export default definePages({
  source: "web",
  out: "site",
  pages: [
    { from: "index.html", route: "/" },
    { from: "404.html", route: "/404.html", keepSource: true }
  ],
  css: {
    files: [
      "tokens.css",
      "base.css",
      "type.css",
      "shell.css",
      "nav.css",
      "theme.css",
      "panel.css",
      "button.css",
      "footer.css",
      "util.css",
      "responsive.css"
    ],
    vars: {
      "--pages-accent": "#147f72",
      "--pages-bg": "#eef3f1"
    },
    dark: {
      "--pages-accent": "#65d9c9",
      "--pages-bg": "#101716"
    }
  },
  runtime: {
    base: "/cube-solver/",
    theme: {
      key: "cube-solver.theme",
      colours: {
        light: "#eef3f1",
        dark: "#101716"
      }
    },
    version: { file: "version.json" }
  }
});
