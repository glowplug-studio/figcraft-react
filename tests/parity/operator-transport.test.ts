import {expect,it} from "vitest";
import {checkOperatorTransport} from "../../src/engine/sharing/operator-transport";

it.each(["ws://share.example:9000/","http://10.0.0.5:9000/","http://127.0.0.1.example/","http://[::ffff:7f00:1]/",
  "http://localhost./","ftp://localhost/"])("refuses the operator key for %s",address=>{
  expect(()=>checkOperatorTransport(address,"operator secret")).toThrow("encrypted connection");
  expect(()=>checkOperatorTransport(address,"\ufeff")).toThrow("encrypted connection");
  expect(()=>checkOperatorTransport(address,"　\t ")).not.toThrow();
  expect(()=>checkOperatorTransport(address)).not.toThrow();
});
it.each(["wss://share.example/","https://share.example/","ws://127.0.0.1:9000/","http://127.5.5.5:3000/",
  "http://localhost:9000/","http://LOCALHOST:9000/","http://[::1]:9000/"])("allows keyed requests on %s",address=>{
  expect(()=>checkOperatorTransport(address,"operator secret")).not.toThrow();
});
