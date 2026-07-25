import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlCardStore } from "../../src/cards/card-store.js";
import { runCardStoreContractSuite, type CardStoreFixture } from "./card-store-contract-suite.js";

function jsonlFactory(): CardStoreFixture {
  const dir = mkdtempSync(join(tmpdir(), "card-store-contract-"));
  const path = join(dir, "cards.jsonl");
  return {
    store: new JsonlCardStore(path),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    listDebris: () => readdirSync(dir).filter((name) => name !== "cards.jsonl"),
  };
}

runCardStoreContractSuite("JsonlCardStore", jsonlFactory);
