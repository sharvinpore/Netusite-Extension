const fs = require("fs");
const path = require("path");

const rootDir = __dirname;

const manifestSrc = path.join(rootDir, "manifest.json");
const manifestDest = path.join(rootDir, "dist", "manifest.json");

const contentSrc = path.join(rootDir, "src", "content.js");
const contentDest = path.join(rootDir, "dist", "content.js");

if (!fs.existsSync("dist")) {
  fs.mkdirSync("dist");
}

fs.copyFileSync(manifestSrc, manifestDest);
fs.copyFileSync(contentSrc, contentDest);

console.log("Postbuild copy completed.");