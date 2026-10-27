import { execFileSync } from "node:child_process";
export function seedAccount(data: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.env.PHP_BIN || "/Applications/MAMP/bin/php/php8.2.0/bin/php",
      ["tests/browser/seed-account.php", JSON.stringify(data)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          APP_ENV: "testing",
          DB_CONNECTION: "sqlite",
          DB_DATABASE:
            process.env.E2E_DATABASE || "/private/tmp/flakflak-browser.sqlite",
          DB_SOCKET: "",
        },
      },
    ),
  );
}
