import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("exposes the status as text, not only as color", () => {
    render(<StatusBadge status="AUTHORIZATION_UNKNOWN" />);
    expect(screen.getByRole("status")).toHaveTextContent("AUTHORIZATION_UNKNOWN");
  });
});
