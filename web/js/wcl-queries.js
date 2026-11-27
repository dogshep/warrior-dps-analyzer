// The Warcraft Logs queries the analyzer runs, shared by the page and the no-sign-in Worker (worker/).
// Each events list is its own query, so each one pages on its own nextPageTimestamp and a long fight
// doesn't re-download every list for every page of another.

export const REPORT_QUERY = `query($code: String!) { reportData { report(code: $code) {
  title startTime
  fights { id encounterID name startTime endTime kill }
  masterData { actors(type: "Player") { id name subType server } abilities { gameID name } }
} } }`;

// GraphQL refuses declared variables a query doesn't use, so each query declares only its own.
const events = (field, withActor, filter, limit) =>
  `query($code: String!, $fight: Int!${withActor ? ', $actor: Int!' : ''}, $start: Float!, $end: Float!) { reportData { report(code: $code) {
  ${field}: events(fightIDs: [$fight], ${filter}startTime: $start, endTime: $end, limit: ${limit}) { data nextPageTimestamp }
} } }`;

export const QUERIES = {
  report: REPORT_QUERY,
  // Everything that involves the warrior, with resources.
  mine: events('mine', true, 'sourceID: $actor, includeResources: true, ', 10000),
  // Buffs others put on the warrior.
  onMe: events('onMe', true, 'targetID: $actor, dataType: Buffs, ', 10000),
  // Debuffs on enemies (armor, attack speed and so on).
  debuffs: events('debuffs', false, 'dataType: Debuffs, hostilityType: Enemies, ', 10000),
  deaths: events('deaths', false, 'dataType: Deaths, ', 10000),
  // The warrior's gear and auras at the start of the fight. One page is enough.
  info: events('info', true, 'sourceID: $actor, dataType: CombatantInfo, ', 100),
};

// The variables each query takes. The page sends only these, and the Worker accepts only these.
export const QUERY_VARS = {
  report: ['code'],
  mine: ['code', 'fight', 'actor', 'start', 'end'],
  onMe: ['code', 'fight', 'actor', 'start', 'end'],
  debuffs: ['code', 'fight', 'start', 'end'],
  deaths: ['code', 'fight', 'start', 'end'],
  info: ['code', 'fight', 'actor', 'start', 'end'],
};
