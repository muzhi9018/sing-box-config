export const platforms = ["linux", "macos", "openwrt", "windows"];

export function renderTemplate(common, platformTemplate) {
  if (!isObject(common) || !isObject(platformTemplate)) {
    throw new Error("RealIP templates must be JSON objects");
  }

  const { overrides = {}, arrays = {} } = platformTemplate;
  if (!isObject(overrides) || !isObject(arrays)) {
    throw new Error("RealIP platform overrides and arrays must be JSON objects");
  }

  const config = mergeObjects(common, overrides);

  for (const [path, edits] of Object.entries(arrays)) {
    const entries = path.split(".").reduce((value, key) => value?.[key], config);
    if (!Array.isArray(entries)) {
      throw new Error(`Expected a RealIP array at ${path}`);
    }
    if (!Array.isArray(edits)) {
      throw new Error(`Expected a list of RealIP array edits at ${path}`);
    }
    for (const edit of edits) {
      applyEdit(entries, edit, path);
    }
  }

  if (!isObject(config.dns) || !Array.isArray(config.inbounds) ||
      !Array.isArray(config.outbounds) || !isObject(config.route)) {
    throw new Error("Incomplete RealIP configuration");
  }

  const { experimental, ...fields } = config;
  if (fields.services?.some(service => service.secret) || experimental?.clash_api?.secret) {
    throw new Error("RealIP templates must use empty API secrets");
  }

  return JSON.stringify({ ...fields, experimental }, null, 2) + "\n";
}

function mergeObjects(base, overrides) {
  const merged = structuredClone({ ...base, ...overrides });
  for (const [key, value] of Object.entries(overrides)) {
    if (isObject(value) && Object.hasOwn(base, key) && isObject(base[key])) {
      merged[key] = mergeObjects(base[key], value);
    }
  }
  return merged;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function applyEdit(entries, { op, match, value }, path) {
  if (op === "move-before") {
    const moved = value.map(tag => entries.splice(entryIndex(entries, { tag }, path), 1)[0]);
    entries.splice(entryIndex(entries, match, path), 0, ...moved);
    return;
  }

  const index = entryIndex(entries, match, path);
  switch (op) {
    case "merge":
      entries[index] = mergeObjects(entries[index], value);
      break;
    case "replace":
      entries[index] = structuredClone(value);
      break;
    case "insert-before":
      entries.splice(index, 0, ...structuredClone(value));
      break;
    case "remove":
      entries.splice(index, 1);
      break;
    default:
      throw new Error(`Unsupported RealIP array operation ${op} at ${path}`);
  }
}

function entryIndex(entries, match, path) {
  const fields = Object.entries(match);
  const matches = entry => fields.every(([key, value]) => entry[key] === value);
  const index = entries.findIndex(matches);
  if (!fields.length || index === -1 || index !== entries.findLastIndex(matches)) {
    throw new Error(`Expected exactly one entry in ${path} matching ${JSON.stringify(match)}`);
  }
  return index;
}
