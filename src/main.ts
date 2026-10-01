// Entry point for the grouplink Workflow service.
//
// Importing ./rebuild registers grouplink.rebuild AND, transitively, every task it
// composes — notion.queryDatabase, scrape.extractMetadata, kv.get/set, http.request,
// slack.postMessage — because each package calls task(...) at module load. All of them
// register into the one shared @renderinc/sdk TaskRegistry (the peerDependency plus
// dedupe-peer-dependents in .npmrc guarantee a single copy), so subtask dispatch by
// name works across packages.
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import "./rebuild.js";

// Zero-dep smoke task, handy for verifying the service is live.
task({ name: "ping" }, function ping(_ctx: TaskContext): string {
  return "pong";
});
