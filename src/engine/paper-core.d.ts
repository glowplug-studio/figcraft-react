// Paper declares its CommonJS export under the extensionless name. Node ESM needs the .js path.
declare module "paper/dist/paper-core.js" {
  import paper = require("paper/dist/paper-core");
  export = paper;
}
