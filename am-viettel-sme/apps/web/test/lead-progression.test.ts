import { describe, expect, it } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";

describe("Task 4: Lead Details, Stage Progression & Business Notes", () => {
  const actor = {
    userId: "user-am",
    workspaceId: "viettel-sme",
    role: "AM" as const,
    teamId: "team-dian",
  };

  it("adds note using the 3-argument signature (actor, leadId, content) and appends to notes list", async () => {
    const services = createDemoApiServices();
    // Test 3-arg signature matching LeadWorkspaceRepository
    await services.leads.addNote(actor, "lead-01", "Gặp anh Bình bàn về hợp đồng Chữ ký số Viettel-CA.");

    const detail = await services.leads.getLeadDetail(actor, "lead-01");
    expect(detail.notes.length).toBeGreaterThanOrEqual(2);
    expect(detail.notes[0]?.content).toBe("Gặp anh Bình bàn về hợp đồng Chữ ký số Viettel-CA.");
  });

  it("transitions lead stage and records an entry in the lead timeline", async () => {
    const services = createDemoApiServices();
    await services.leads.transitionStage(actor, "lead-01", "QUALIFIED");

    const detail = await services.leads.getLeadDetail(actor, "lead-01");
    expect(detail.stage).toBe("QUALIFIED");
    expect(detail.timeline.some((t) => t.action === "STAGE_CHANGE")).toBe(true);
  });
});
