const appName = "[Sibyl Monitoring System]";
const endpointRaw = new URL(import.meta.url).searchParams.get("endpoint");
const endpoint = endpointRaw ? decodeURIComponent(endpointRaw) : null;
const isBrowser = typeof window !== "undefined";
const isLocal =
  !isBrowser ||
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
  location.hostname.includes("192.");
const isRobot = /bot|googlebot|crawler|spider|robot|crawling/i.test(
  isBrowser ? navigator.userAgent : ""
);
const isFrenchOrNull = (v) => v === "FR" || !v;
const rawConsole = isBrowser ? { ...globalThis.console } : {};
const browser = (fn) => (isBrowser ? fn : () => null);
const dev = {
  log: browser((...e) => rawConsole.log(appName, ...e)),
  error: browser((...e) => rawConsole.error(appName, ...e)),
};
if (!endpoint) dev.error("missing endpoint");

const postHeaders = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
};

const request = (e, variables) =>
  fetch(e, {
    ...postHeaders,
    body: JSON.stringify(variables),
  })
    .then((res) => res.json())
    .then((json) =>
      json?.errors
        ? json.errors.forEach(({ message }) => dev.error(message))
        : json?.data
        ? dev.log("sent", variables)
        : ""
    );

const tracePromise = fetch("https://www.cloudflare.com/cdn-cgi/trace")
  .then((r) => r.text())
  .then((t) => t.split("\n").map((l) => l.split("=")))
  .then((entries) => Object.fromEntries(entries))
  .catch(() => {});

const rateFactory = ({ to = 3, per = 30 * 1000 } = {}) => {
  const queue = [];
  let time = 0;
  let count = 0;
  let difference = 0;
  const limit = (func) => {
    if (func) queue.push(func);
    difference = per - (Date.now() - time);
    if (difference <= 0) {
      time = Date.now();
      count = 0;
    }
    if (++count <= to) queue.shift()();
    else setTimeout(limit, difference);
  };
  return limit;
};

const main = () => {
  const rateLimiter = rateFactory();
  const send = (e) => {
    return rateLimiter(async () => {
      dev.log("Error Reporting...");
      const trace = await tracePromise;
      const stacktrace = e?.stack || e?.message;
      const payload = {
        href: window?.location?.href,
        userAgent: globalThis?.navigator?.userAgent,
        hostname: window?.location?.hostname,
        ip: trace?.ip,
        country: trace?.loc,
        data:
          typeof window?.SIBYL_MONITORING_DATA === "object"
            ? JSON.stringify(window.SIBYL_MONITORING_DATA)
            : null,
        stacktrace,
        ...e,
      };
      isLocal || isRobot || !isFrenchOrNull(payload.country) || !endpoint
        ? dev.log(payload)
        : request(endpoint, payload);
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    const args = Object.values(arguments);
    ["error", "timeout"].map((message) =>
      this.addEventListener(message, function () {
        send({
          type: "network",
          name: args.join(", "),
          message: message ?? "",
          stack: "",
        });
      })
    );
    origOpen.apply(this, arguments);
  };

  console.error = (() => {
    const consoleError = console.error;
    return function (...args) {
      try {
        throw Error(
          args
            .map((d) => (String(d).includes("[object") ? JSON.stringify(d) : d))
            .join("\n")
        );
      } catch (err) {
        consoleError(...args);
        send({
          type: "error",
          name: err?.name ?? "",
          message: err?.message ?? err?.target?.src ?? "",
          stack: err?.stack ?? "",
        });
      }
    };
  })();

  ["rejectionhandled", "unhandledrejection"].map((type) =>
    window.addEventListener(
      type,
      ({ reason, stack, name }) => {
        send({
          type,
          name: name ?? "",
          message: `${reason}`,
          stack: stack ?? "",
        });
        return false;
      },
      true
    )
  );

  window.addEventListener(
    "error",
    function (err) {
      const { message, stack, name } = err?.error ?? err;
      send({
        type: "error",
        name: name ?? err?.name ?? "",
        message: message ?? err?.message ?? err?.target?.src ?? "",
        stack: stack ?? err?.stack ?? "",
      });
      return false;
    },
    true
  );
  dev.log("Activated");
};

if (isBrowser) main();

