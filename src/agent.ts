import { Agent } from "agents";
import { generateText, isStepCount } from "ai";
import {
  chatModel,
  handleChatRequest,
  partnerCell,
  rememberTurn,
  toModelMessages,
  traceTools,
  type ChatReply,
  type ChatState,
  type PartnerLink
} from "./ops/agent-kit";

/** Who your agent is and how it should behave. Make it your own. */
const SYSTEM_PROMPT = `You are the duty watchkeeper in a cell's ops room on Exercise ORANGE CLOUD, a joint relief exercise on the island of Halcyon after a storm.
You help the ops team raise requests for support, keep them moving and keep the stores topped up.

Rules:
- Use your tools for anything about stores, sites, conditions or requests. Call get_sitrep first if you don't have a recent one. Never guess stock, site ids or request numbers.
- Sites are distribution points DP ALPHA to DP HOTEL, with ids alpha to hotel. Quantities are pallets.
- Only say something is done after the tool call worked. If a tool returns an error, say what it said and suggest what to do next.
- Raise what you are asked to raise and let the ops room judge it. Never trim or refuse a request yourself because of a reserve: raise it in full, and the tool result says whether it is held.
- A request with status "held" is waiting for the Duty Officer, a human, to approve it on the ops board. You can't approve it yourself. Say so.
- Always give request numbers, like #104.
- If you have no tools available, say you are not on the net yet.
- Be brief and factual, as a good watchkeeper is. Plain text, no emoji, no sign-offs like "let me know if you need anything else".`;

/** Phase 4: extra orders once a partner cell is linked. Sharpen them. */
function jointOrders(partner: PartnerLink | null): string {
  if (!partner) return "";
  return `

Joint tasking. Your partner cell is ${partner.callsign}, a ${partner.roleLabel.toLowerCase()}. ${partner.about}
- Tools named tool_partner_... act on ${partner.callsign}'s ops room. Tools named tool_cell_... act on your own. Never mix them up.
- Try your own cell first. When a tool error says your cell can't do it (a road is cut, flying is suspended, the load is too big), hand the request to ${partner.callsign}: read their picture with tool_partner_get_sitrep, then raise it with tool_partner_raise_request. Split the load if it is more than they can carry in one request.
- If the request was already on your own board, cancel your copy once theirs is raised, so the stores aren't committed twice.
- Don't task or move ${partner.callsign}'s requests for them. Say what you handed over, with their request numbers.`;
}

/**
 * Phase 4, finished: a watchkeeper that runs your ops room through your MCP
 * server and hands work to your partner cell through theirs.
 *
 * Each chat session gets its own Watchkeeper instance. It's a Durable Object,
 * so it keeps its state (the conversation) between messages.
 */
export class Watchkeeper extends Agent<Env, ChatState> {
  initialState: ChatState = { messages: [] };

  // The chat UI at /chat talks to this agent over HTTP.
  async onRequest(request: Request) {
    return handleChatRequest(this, request);
  }

  async chat(message: string, origin: string): Promise<ChatReply> {
    // 1. Connect to your own MCP server, the same way Cloudflare OS did.
    //    The id makes your tools show up as tool_cell_<name>. The headers tell
    //    the ops board these calls come from your watchkeeper.
    //    (Safe to call every time: it reuses the existing connection.)
    await this.addMcpServer("cell", `${origin}/mcp`, {
      id: "cell",
      transport: {
        type: "streamable-http",
        headers: { "x-cell-client": "agent", "x-cell-origin": origin }
      }
    });

    // 2. Link to your partner cell, the one set on your ops board. Your
    //    watchkeeper now holds two MCP servers at once: yours and theirs.
    const partner = await partnerCell(this, origin);
    if (partner) {
      await this.addMcpServer("partner", partner.mcpUrl, {
        id: "partner",
        transport: { type: "streamable-http", headers: partner.headers }
      });
    }

    // 3. Give the model the conversation so far plus every tool from every
    //    connected MCP server. The model picks tools, the SDK runs them over
    //    MCP and feeds the results back, round after round, until it has an answer.
    const result = await generateText({
      model: chatModel(this.env),
      system: SYSTEM_PROMPT + jointOrders(partner),
      messages: toModelMessages(this.state.messages, message),
      tools: this.mcp.getAITools(),
      stopWhen: isStepCount(10)
    });

    // 4. Remember the conversation. setState saves it in this agent's storage.
    const tools = traceTools(this, result.steps);
    this.setState(rememberTurn(this.state, message, result.text, tools));

    return { reply: result.text, tools };
  }
}
