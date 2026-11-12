import { describe, expect, it } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";

describe("Task 2: Task Management and Dashboard Status Filtering", () => {
  const actor = {
    userId: "user-am",
    workspaceId: "viettel-sme",
    role: "AM" as const,
    teamId: "team-dian",
  };

  it("filters tasks by status OPEN and IN_PROGRESS without returning duplicates or completed tasks", async () => {
    const services = createDemoApiServices();

    // Initial state has 3 tasks with status OPEN
    const openTasks = await services.tasks.listTasks(actor, { status: "OPEN" });
    expect(openTasks.length).toBe(3);
    expect(openTasks.every((t) => t.id.startsWith("task-"))).toBe(true);

    const inProgressTasks = await services.tasks.listTasks(actor, { status: "IN_PROGRESS" });
    expect(inProgressTasks.length).toBe(0);

    // Complete task-01
    await services.tasks.completeTask(actor, "task-01", { outcome: "Hoàn tất nghiệp vụ" });

    // Open tasks should now only have 2 tasks (task-02, task-03)
    const openTasksAfter = await services.tasks.listTasks(actor, { status: "OPEN" });
    expect(openTasksAfter.length).toBe(2);
    expect(openTasksAfter.map((t) => t.id)).not.toContain("task-01");

    // Completed tasks (status: DONE) should now contain task-01
    const completedTasks = await services.tasks.listTasks(actor, { status: "DONE" });
    expect(completedTasks.length).toBe(1);
    expect(completedTasks[0]?.id).toBe("task-01");
  });

  it("filters tasks by assigneeUserId", async () => {
    const services = createDemoApiServices();
    const amTasks = await services.tasks.listTasks(actor, { assigneeUserId: "user-am" });
    expect(amTasks.length).toBe(3);

    const otherTasks = await services.tasks.listTasks(actor, { assigneeUserId: "user-other" });
    expect(otherTasks.length).toBe(0);
  });
});
