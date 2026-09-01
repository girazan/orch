// Contract v2 schema helpers (spec §1). Pure functions — the executable
// definition of ranks, floors, and validation that v0.8.0 gating hooks and
// the setup skill's interview both lean on. No I/O here, ever.
'use strict';

const RANKS = ['low', 'mid', 'high', 'frontier'];

function rankIndex(role) {
  return RANKS.indexOf(role);
}

function modelRank(models, modelName) {
  // Duplicate model names across ranks resolve to the HIGHEST rank
  // (fail-strict): a floor comparison must never undercount a model.
  let best = -1;
  if (!models) return best;
  for (const role of RANKS) {
    if (models[role] === modelName && rankIndex(role) > best) best = rankIndex(role);
  }
  return best;
}

function validateModels(models) {
  const problems = [];
  if (!models || typeof models !== 'object') return ['models map missing'];
  for (const role of RANKS) {
    if (typeof models[role] !== 'string' || !models[role]) problems.push(`models.${role} missing or not a string`);
  }
  return problems;
}

function floorsFor(contract, domainNames) {
  // A domain's tiers may be partial — a missing work/review key resolves
  // via rankIndex(undefined) === -1, i.e. "no floor on that axis".
  let work = -1, review = -1;
  const domains = (contract && contract.domains) || {};
  for (const name of domainNames || []) {
    const t = domains[name] && domains[name].tiers;
    if (!t) continue;
    if (rankIndex(t.work) > work) work = rankIndex(t.work);
    if (rankIndex(t.review) > review) review = rankIndex(t.review);
  }
  return work < 0 && review < 0 ? null : { work, review };
}

function schemaVersion(contract) {
  return contract && Number(contract.schemaVersion) === 2 ? 2 : 1;
}

function validateTiers(contract) {
  const problems = [];
  const domains = (contract && contract.domains) || {};
  for (const [name, d] of Object.entries(domains)) {
    const t = d && d.tiers;
    if (!t || typeof t !== 'object') continue;
    for (const [key, value] of Object.entries(t)) {
      if (key !== 'work' && key !== 'review') {
        problems.push(`domains.${name}.tiers unknown key '${key}'`);
        continue;
      }
      if (rankIndex(value) < 0) problems.push(`domains.${name}.tiers.${key} unknown role '${value}'`);
    }
  }
  return problems;
}

module.exports = { RANKS, rankIndex, modelRank, validateModels, floorsFor, schemaVersion, validateTiers };
