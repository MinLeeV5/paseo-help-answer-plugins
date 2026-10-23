import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const { outputFiles } = await build({ entryPoints: ["tests/fixture.ts"], bundle: true, write: false, platform: "browser", format: "iife", target: "chrome120" });
const html = await readFile("tests/fixture.html");
createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("content-type", "text/javascript; charset=utf-8"); response.end(outputFiles[0].contents);
  } else if (request.url === "/") {
    response.setHeader("content-type", "text/html; charset=utf-8"); response.end(html);
  } else { response.statusCode = 404; response.end(); }
}).listen(4178, "127.0.0.1", () => process.stdout.write("Desktop fixture: http://127.0.0.1:4178\n"));
