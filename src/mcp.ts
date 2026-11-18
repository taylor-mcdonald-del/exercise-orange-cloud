import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Cell } from "./ops/client";

/**
 * Phase 2, finished: an MCP server that can run your ops room.
 */
export function createOpsMcpServer(cell: Cell) {
  const server = new McpServer(
    { name: "ops-room", version: "1.0.0" },
    {
      instructions: `Tools for the ops room of ${cell.label} on Exercise ORANGE CLOUD, a relief exercise. ${cell.about} Quantities are in pallets. Sites are distribution points with ids alpha to hotel.`
    }
  );

  server.registerTool(
    "get_sitrep",
    {
      title: "Get the SITREP",
      description: `${cell.label}: the current picture. Conditions (flying, roads cut), stores with pallets on hand and the reserve level (the reserve is part of the pallets on hand, not extra), sites, and how many requests are at each stage. Start here.`,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true }
    },
    async () => asText(await cell.getSitrep())
  );

  server.registerTool(
    "raise_request",
    {
      title: "Raise a request for support",
      description: `${cell.label}: raise a request for support, a load of stores for one distribution point. Use site and store ids from get_sitrep. Stock is committed straight away. A request that takes a store below its reserve comes back with status "held" and waits for a human to approve it on the ops board. Returns the request number.`,
      inputSchema: z.object({
        site: z.string().describe("Site id: alpha, bravo, charlie, delta, echo, foxtrot, golf or hotel"),
        items: z
          .array(
            z.object({
              storeId: z.string().describe("Store id from get_sitrep, e.g. water"),
              qty: z.number().int().min(1).max(24).default(1).describe("How many pallets")
            })
          )
          .min(1)
          .describe("What the site needs"),
        precedence: z
          .enum(["routine", "priority", "immediate", "flash"])
          .default("routine")
          .describe("How urgent it is. FLASH is life or death"),
        note: z.string().max(140).optional().describe("Anything the crew should know, e.g. deliver to the school hall")
      })
    },
    async ({ site, items, precedence, note }) => asText(await cell.raiseRequest({ site, items, precedence, note }))
  );

  server.registerTool(
    "list_requests",
    {
      title: "List requests",
      description: `${cell.label}: list requests for support, newest first. "open" (the default) means anything not yet delivered or cancelled. Optionally filter by site.`,
      inputSchema: z.object({
        status: z
          .enum(["open", "held", "requested", "tasked", "en_route", "delivered", "cancelled", "all"])
          .default("open")
          .describe("Which requests to show"),
        site: z.string().optional().describe("Only this site id, e.g. echo")
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ status, site }) => asText(await cell.listRequests({ status, site }))
  );

  server.registerTool(
    "update_request_status",
    {
      title: "Update a request's status",
      description: `${cell.label}: move a request along: requested → tasked → en_route → delivered. Requests only move forward. "cancelled" cancels it and returns the stock. A held request can't move until a human approves it on the ops board.`,
      inputSchema: z.object({
        requestId: z.number().int().describe("The request number, e.g. 101"),
        status: z.enum(["tasked", "en_route", "delivered", "cancelled"]).describe("The new status")
      })
    },
    async ({ requestId, status }) => asText(await cell.updateRequestStatus(requestId, status))
  );

  server.registerTool(
    "resupply_store",
    {
      title: "Resupply a store",
      description: `${cell.label}: add pallets to a store, for example after a resupply run. Use store ids from get_sitrep.`,
      inputSchema: z.object({
        storeId: z.string().describe("Store id from get_sitrep"),
        quantity: z.number().int().min(1).max(50).describe("How many pallets to add")
      })
    },
    async ({ storeId, quantity }) => asText(await cell.resupplyStore(storeId, quantity))
  );

  return server;
}

/** MCP tools return content blocks. JSON as text is the simplest thing that works well with models. */
function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
