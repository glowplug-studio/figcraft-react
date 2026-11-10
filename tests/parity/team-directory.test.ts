import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {readTeamDirectory, teamFileLink, teamWebLink, validTeamWeb} from "../../src/engine/sharing/team-directory";

const cases = readFileSync(new URL("../fixtures/native-team-directory.tsv",import.meta.url),"utf8").trimEnd().split("\n");
const file = {file:"id", name:" Drawing ", updated:"18446744073709551615", people:2, access:"edit"};
it.each(cases.map((line,index) => ({parts:line.split("\t"),index})))("matches pinned team directory case $index", ({parts}) => {
  const [kind,input,value,web,native,browser] = parts;
  if (kind === "link") {
    const link = teamFileLink(input,value);
    expect(link).toBe(native);
    expect(teamWebLink(web,link)).toBe(browser);
  } else if (kind === "web") {
    expect(validTeamWeb(input)).toBe(value === "true");
  } else {
    const result = readTeamDirectory({state:"listed",files:[{...file,file:input}]});
    expect(result.state === "listed" && result.files.length === 1).toBe(value === "true");
  }
});
it("limits accepted files after filtering, trims scalar names and strips untrusted response fields", () => {
  const row = {...file, name:"  A\x00" + "🙂".repeat(300) + "  ",token:"irrelevant"};
  const directory = readTeamDirectory({state:"listed",web:"https://example.org/#fragment",files:[
    {...row,file:"bad&id"},...Array.from({length:501},(_,i) => ({...row,file:String(i)}))
  ]});
  if (directory.state !== "listed") throw new Error("Expected directory");
  expect(directory.files).toHaveLength(500);
  expect(directory.files[499]).toEqual({...file,file:"499",name:"A"+"🙂".repeat(255)});
  expect(directory.web).toBe("");
});
