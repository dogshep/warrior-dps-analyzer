// The two Warcraft Logs queries the analyzer runs, shared by the page and the no-sign-in Worker (worker/).

export const REPORT_QUERY = `query($code: String!) { reportData { report(code: $code) {
  title startTime
  fights { id encounterID name startTime endTime kill }
  masterData { actors(type: "Player") { id name subType server } abilities { gameID name } }
} } }`;

export const EVENTS_QUERY = `query($code: String!, $fight: Int!, $actor: Int!, $start: Float!, $end: Float!) { reportData { report(code: $code) {
  mine: events(fightIDs: [$fight], sourceID: $actor, startTime: $start, endTime: $end, includeResources: true, limit: 10000) { data nextPageTimestamp }
  onMe: events(fightIDs: [$fight], targetID: $actor, startTime: $start, endTime: $end, dataType: Buffs, limit: 10000) { data nextPageTimestamp }
  debuffs: events(fightIDs: [$fight], startTime: $start, endTime: $end, dataType: Debuffs, hostilityType: Enemies, limit: 10000) { data nextPageTimestamp }
  deaths: events(fightIDs: [$fight], startTime: $start, endTime: $end, dataType: Deaths, limit: 10000) { data nextPageTimestamp }
  info: events(fightIDs: [$fight], sourceID: $actor, startTime: $start, endTime: $end, dataType: CombatantInfo, limit: 100) { data }
} } }`;

export const QUERIES = { report: REPORT_QUERY, events: EVENTS_QUERY };
