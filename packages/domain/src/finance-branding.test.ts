import { projectFinanceInstitutionBranding } from "./finance.js";

const logo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ZkAAAAASUVORK5CYII=";
const branding = { institutionId: "ins_1", logo, primaryColor: "#004466", url: null };
it("omits decorative bitmap data from default agent/context projections without changing metadata or cache", () => {
  expect(projectFinanceInstitutionBranding(branding)).toEqual({ ...branding, logo: null });
  expect(branding.logo).toBe(logo);
  expect(projectFinanceInstitutionBranding(null)).toBeNull();
});
it("retains bitmap artwork only for explicitly requested human UI projections", () => {
  expect(projectFinanceInstitutionBranding(branding, true)).toEqual(branding);
});
