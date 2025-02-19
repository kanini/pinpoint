import { describe, it, expect } from "bun:test";
import { geocodeAddress } from "../pinpoint";

describe("geocodeAddress (Unit)", () => {
  // This test will call the live API. If offline or if the geocoder is down, it may fail.
  it("returns non-null coordinates for a likely valid address", async () => {
    const coords = await geocodeAddress(
      "1600 Pennsylvania Ave NW, Washington DC",
      1,
    );
    // We just check that it isn't null
    expect(coords).not.toBeNull();
    if (coords) {
      expect(typeof coords.lat).toBe("number");
      expect(typeof coords.lon).toBe("number");
    }
  });

  it("returns null for a likely invalid address", async () => {
    const coords = await geocodeAddress("4ddress_th4t_d0es_n0t_ex1st", 2);
    expect(coords).toBeNull();
  });
});
