/**
 * Seed script: backfills the Ambient DB with demo transcript data for 4 scenarios.
 * Run: npx tsx scripts/seed-demo.ts
 *
 * Expects a fresh DB (user resets beforehand). Creates sessions + transcript blocks only.
 * Agents/tasks/summaries are left for the real product to generate.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createDatabase } from "../src/core/db/db";

const DB_PATH = path.join(
  os.homedir(),
  "Library/Application Support/ambient/ambient.db",
);

const appDb = createDatabase(DB_PATH);
const db = appDb.raw;

const BASE_TS = Date.now();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type BlockSeed = {
  sourceText: string;
  translation?: string;
  audioSource: "system" | "mic";
  newTopic?: boolean;
};

function insertSession(
  id: string,
  title: string,
  startedAt: number,
  endedAt: number,
  blockCount: number,
  sourceLang = "en",
  targetLang = "",
) {
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, started_at, ended_at, title, block_count, source_lang, target_lang)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, startedAt, endedAt, title, blockCount, sourceLang, targetLang);
}

function updateSession(id: string, endedAt: number, blockCount: number) {
  db.prepare("UPDATE sessions SET ended_at = ?, block_count = ? WHERE id = ?").run(endedAt, blockCount, id);
}

function insertBlocks(
  sessionId: string,
  seeds: BlockSeed[],
  startTs: number,
  gapMs: [number, number],
  sourceLabel: string,
  targetLabel: string,
) {
  const stmt = db.prepare(`
    INSERT INTO blocks (session_id, source_label, source_text, target_label, translation, audio_source, partial, new_topic, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  let ts = startTs;
  for (const seed of seeds) {
    stmt.run(
      sessionId,
      sourceLabel,
      seed.sourceText,
      targetLabel,
      seed.translation ?? null,
      seed.audioSource,
      seed.newTopic ? 1 : 0,
      ts,
    );
    ts += gapMs[0] + Math.floor(Math.random() * (gapMs[1] - gapMs[0]));
  }
  return ts;
}

// ===========================================================================
// 1. TRIP PLANNING — Group of friends planning a Japan trip
// ===========================================================================
const TRIP_SESSION_ID = `trip-${randomUUID().slice(0, 8)}`;
const TRIP_START = BASE_TS - 25 * 60_000;

const TRIP_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay so Japan. We're actually doing this right?", audioSource: "system", newTopic: true },
  { sourceText: "Yeah I already checked, cherry blossom season peaks like late March to mid April in Tokyo.", audioSource: "mic" },
  { sourceText: "April works for me. I was thinking maybe April 5th through the 15th? That's like ten days.", audioSource: "system" },
  { sourceText: "That's kinda tight if we wanna do Tokyo AND Kyoto AND maybe Hakone. But doable.", audioSource: "mic" },
  { sourceText: "I looked at flights last night actually. From SFO, round trip was like $850 on ANA, or $680 on Zipair but that's budget.", audioSource: "system", translation: "昨夜フライトを調べたんだけど、SFOからの往復でANAが850ドルくらい、Zipairだと680ドルだけどLCCだね。" },
  { sourceText: "Zipair is fine honestly, it's only like 10 hours. We can survive.", audioSource: "mic" },
  { sourceText: "True. Okay so budget-wise, what are we thinking per person? All in?", audioSource: "system", newTopic: true },
  { sourceText: "I'd say $2500 max? Not counting flights. Like for hotels, food, trains, activities.", audioSource: "mic", translation: "2500ドルくらいかな？フライト抜きで。ホテル、食事、電車、アクティビティ込みで。" },
  { sourceText: "That should be plenty. I heard you can get a 7-day JR Pass for like $200 now.", audioSource: "system" },
  { sourceText: "Oh wait we should definitely do a ryokan at some point. Like in Hakone. With the onsen and everything.", audioSource: "mic", newTopic: true },
  { sourceText: "Yes! I've been looking at those. Some of them are insane though, like $400 a night.", audioSource: "system" },
  { sourceText: "There's nice ones under $250 if you book early. I'll look into it.", audioSource: "mic", translation: "早めに予約すれば250ドル以下のいい旅館もあるよ。調べてみるね。" },
  { sourceText: "Perfect. What about Tokyo — Shinjuku or Shibuya for the hotel?", audioSource: "system", newTopic: true },
  { sourceText: "Shinjuku for sure. It's more central for day trips and the station connects to everything.", audioSource: "mic" },
  { sourceText: "Also we need to figure out the Kyoto part. How many nights there?", audioSource: "system" },
  { sourceText: "I'd say three nights? There's so much to see. Fushimi Inari, Arashiyama, the temples...", audioSource: "mic", translation: "3泊かな？見どころたくさんあるし。伏見稲荷、嵐山、お寺..." },
  { sourceText: "And we need to eat at that ramen place Marcus went to. He said it was life-changing. What was it called?", audioSource: "system" },
  { sourceText: "Fuunji? No wait, that's the tsukemen place in Shinjuku. I think Marcus went to Ichiran.", audioSource: "mic" },
  { sourceText: "Okay so action items — someone book flights before prices go up, someone research ryokans, and we need the JR Pass sorted.", audioSource: "system", newTopic: true },
  { sourceText: "I'll handle the ryokan search. Can you do flights? And maybe we make a shared doc for the itinerary.", audioSource: "mic", translation: "旅館は私が調べるよ。フライトはお願いできる？あと共有ドキュメント作ろうか。" },
];

// ===========================================================================
// 2. RESEARCH & BRAINSTORMING — Solo founder thinking aloud
// ===========================================================================
const BRAIN_SESSION_ID = `brain-${randomUUID().slice(0, 8)}`;
const BRAIN_START = BASE_TS - 40 * 60_000;

const BRAIN_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay so the idea is basically... an AI recipe app that knows what's in your fridge and adapts to your dietary restrictions.", audioSource: "mic", newTopic: true },
  { sourceText: "Like you open your fridge, you snap a photo, and it tells you what you can make. That's the core loop.", audioSource: "mic" },
  { sourceText: "But there's gotta be a hundred apps that do this already right? What makes this different.", audioSource: "mic" },
  { sourceText: "Hmm. The angle could be... it learns your taste over time. Like a personal chef that knows you hate cilantro and you're trying to eat less carbs this month.", audioSource: "mic", newTopic: true },
  { sourceText: "Oh actually, the real differentiator might be dietary restrictions for families. Like my household — I'm lactose intolerant, my partner is vegetarian, and my kid won't eat anything green.", audioSource: "mic" },
  { sourceText: "So it finds recipes that work for ALL of us. That's the wedge. Multi-profile household meal planning.", audioSource: "mic" },
  { sourceText: "Competitors... there's Whisk, there's Mealime, Paprika, SuperCook. SuperCook does the ingredient matching thing already.", audioSource: "mic", newTopic: true },
  { sourceText: "But none of them do the multi-profile thing well. And they're all kinda Web 2.0 feeling, not really AI-native.", audioSource: "mic" },
  { sourceText: "Wait, business model. Freemium obviously. Free tier gets like 5 recipes a week, premium gets unlimited plus grocery list integration and smart substitutions.", audioSource: "mic", newTopic: true },
  { sourceText: "Actually the real money might be in grocery partnerships. Like if we can integrate with Instacart or Walmart, there's affiliate revenue there.", audioSource: "mic" },
  { sourceText: "Target market... health-conscious millennials with families. Dual income, no time to meal plan. That's like our entire friend group basically.", audioSource: "mic", newTopic: true },
  { sourceText: "On the tech side, I need a food recognition model for the fridge photo thing. There's Clarifai, there's Google Vision, or we fine-tune something ourselves.", audioSource: "mic" },
  { sourceText: "For the recipe database, Spoonacular API is solid. Or we could scrape and build our own, but that's a rabbit hole.", audioSource: "mic" },
  { sourceText: "Oh and nutritional data — we need that for the dietary restrictions engine. USDA FoodData Central is free and comprehensive.", audioSource: "mic" },
  { sourceText: "I think the MVP is... photo recognition, basic dietary profiles, recipe suggestions. Skip the grocery integration for now. Ship in 6 weeks.", audioSource: "mic", newTopic: true },
  { sourceText: "Name ideas... FridgeAI? No that's terrible. PantryPal? CookSmart? Ugh, I'll think about it later.", audioSource: "mic" },
  { sourceText: "Next step is to validate the multi-profile thing. I should interview like 10 families and see if this is actually a pain point or just my pain point.", audioSource: "mic" },
];

// ===========================================================================
// 3. STUDY SESSION — Two CS students on distributed systems
// ===========================================================================
const STUDY_SESSION_ID = `study-${randomUUID().slice(0, 8)}`;
const STUDY_START = BASE_TS - 35 * 60_000;

const STUDY_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay so the exam is Thursday and I still don't fully get the difference between Raft and Paxos.", audioSource: "system", newTopic: true },
  { sourceText: "So Paxos is like the OG consensus algorithm right? Lamport proposed it. But it's notoriously hard to implement because the paper is like... deliberately obtuse.", audioSource: "mic" },
  { sourceText: "Right and Raft was designed to be understandable. That's literally the whole point of the Raft paper — they wanted something equivalent to Paxos but easier to reason about.", audioSource: "system" },
  { sourceText: "Exactly. The key difference is Raft uses a strong leader model. One node is THE leader and all writes go through it. Paxos is more... democratic? Any node can propose.", audioSource: "mic" },
  { sourceText: "Wait so like, in Raft if the leader dies, what happens?", audioSource: "system" },
  { sourceText: "Leader election. The followers have a timeout, and if they don't hear from the leader, one of them becomes a candidate and starts an election. You need a majority to win.", audioSource: "mic" },
  { sourceText: "Okay that makes sense. What about CAP theorem though? How does that relate?", audioSource: "system", newTopic: true },
  { sourceText: "So CAP says you can only have two out of three: Consistency, Availability, Partition tolerance. And since network partitions always happen in distributed systems, you're really choosing between C and A.", audioSource: "mic" },
  { sourceText: "And Raft chooses CP right? It sacrifices availability during a partition because the minority partition can't accept writes.", audioSource: "system" },
  { sourceText: "Yeah exactly. If you lose the majority, the system blocks rather than serving stale data. That's the CP tradeoff.", audioSource: "mic" },
  { sourceText: "What about vector clocks? Is that gonna be on the exam?", audioSource: "system", newTopic: true },
  { sourceText: "Professor mentioned it in the review session so probably. Vector clocks track causality across nodes. Each node maintains a vector of counters, one per node in the system.", audioSource: "mic" },
  { sourceText: "So if event A has a vector clock that's strictly less than event B's vector clock, then A happened before B. Otherwise they're concurrent.", audioSource: "system" },
  { sourceText: "Right. And the key thing is you compare element-wise. If any element in A is greater and any in B is greater, they're concurrent — you can't establish a causal order.", audioSource: "mic" },
  { sourceText: "Okay I think I need to do practice problems on this. Do you have that problem set from week 8?", audioSource: "system", newTopic: true },
  { sourceText: "Yeah I'll send it over. Also we should probably review Byzantine fault tolerance. That's the hardest section and I bet there'll be at least one question.", audioSource: "mic" },
  { sourceText: "Oh god, BFT. The one where nodes can actively lie? How many faulty nodes can you tolerate again?", audioSource: "system" },
  { sourceText: "You need at least 3f plus 1 nodes to tolerate f Byzantine faults. So for 1 faulty node you need 4 total. It's way more expensive than crash fault tolerance.", audioSource: "mic" },
];

// ===========================================================================
// 4. TEAM MEETING — Engineering standup / sprint planning
// ===========================================================================
const MEETING_SESSION_ID = `meeting-${randomUUID().slice(0, 8)}`;
const MEETING_START = BASE_TS - 30 * 60_000;

const MEETING_BLOCKS: BlockSeed[] = [
  { sourceText: "Alright let's get started. Sprint review first then we'll do planning for next sprint. Sarah, you wanna kick off?", audioSource: "system", newTopic: true },
  { sourceText: "Sure. So this sprint I shipped the new auth flow with OAuth2. It's behind a feature flag right now. I also fixed that nasty race condition in the session middleware.", audioSource: "mic" },
  { sourceText: "Nice. How's the OAuth2 testing looking? Any edge cases we should worry about?", audioSource: "system" },
  { sourceText: "I tested the main flows — Google, GitHub, email magic link. The one thing I'm not confident about is the token refresh logic when users have multiple tabs open.", audioSource: "mic" },
  { sourceText: "That's a good call. Let's file that as a known issue and address it next sprint. Jake, how about you?", audioSource: "system", newTopic: true },
  { sourceText: "I got the payment integration with Stripe mostly done. Subscriptions are working, webhook handling is solid. But I'm blocked on the invoicing piece because we need legal to sign off on the tax calculation approach.", audioSource: "mic" },
  { sourceText: "I'll ping legal today. That's been sitting for a week. When they unblock you, how long to finish?", audioSource: "system" },
  { sourceText: "Probably two days? The code is written, I just need to swap in the real tax rates and test with their approved configuration.", audioSource: "mic" },
  { sourceText: "Cool. Alright, for next sprint priorities. Number one is getting the OAuth2 flag removed and rolling it out to 100% of users.", audioSource: "system", newTopic: true },
  { sourceText: "I'd also say we need to prioritize the dashboard performance issue. Users are complaining that the analytics page takes 8 seconds to load.", audioSource: "mic" },
  { sourceText: "Yeah that's been in the backlog too long. The query is doing like 6 joins and no caching. We should probably add a materialized view or precompute the aggregates.", audioSource: "system" },
  { sourceText: "I can take that. I've been meaning to set up Redis caching for the analytics anyway. Kill two birds.", audioSource: "mic" },
  { sourceText: "Perfect. So next sprint: OAuth2 rollout for Sarah, Stripe invoicing for Jake once legal approves, and dashboard perf for Jake as well?", audioSource: "system", newTopic: true },
  { sourceText: "That's a lot for Jake. Can we pull in the dashboard perf to me? I'm lighter next sprint since OAuth is mostly done.", audioSource: "mic" },
  { sourceText: "Even better. Sarah takes dashboard perf, Jake finishes Stripe. We also need someone to write the migration guide for the auth changes since it affects the API.", audioSource: "system" },
  { sourceText: "I'll write the migration guide. It's my code, I should document it. I'll have a draft by Wednesday.", audioSource: "mic" },
  { sourceText: "Last thing — we need to decide on the monitoring story. Are we going with Datadog or sticking with Grafana? This has been punted three times.", audioSource: "system", newTopic: true },
  { sourceText: "I vote Datadog. The APM tracing is way better and we're spending too much time maintaining our Grafana dashboards. The cost difference isn't that big for our scale.", audioSource: "mic" },
  { sourceText: "Agreed. Let's make the call — Datadog it is. Jake, can you set up the initial integration as a stretch goal?", audioSource: "system" },
  { sourceText: "Yeah I can start the Datadog setup if Stripe wraps up early. I'll timebox it to a day.", audioSource: "mic" },
];

// ===========================================================================
// Insert everything
// ===========================================================================
const insertAll = db.transaction(() => {
  // Create sessions first (FK constraint: blocks reference session_id)
  insertSession(TRIP_SESSION_ID, "Japan Trip Planning", TRIP_START, TRIP_START, 0, "en", "ja");
  insertSession(BRAIN_SESSION_ID, "AI Recipe App Brainstorm", BRAIN_START, BRAIN_START, 0, "en", "");
  insertSession(STUDY_SESSION_ID, "Distributed Systems Exam Prep", STUDY_START, STUDY_START, 0, "en", "");
  insertSession(MEETING_SESSION_ID, "Sprint Review & Planning", MEETING_START, MEETING_START, 0, "en", "");

  // Insert blocks and update session end times + block counts
  const tripEnd = insertBlocks(TRIP_SESSION_ID, TRIP_BLOCKS, TRIP_START, [5000, 10000], "English", "Japanese");
  updateSession(TRIP_SESSION_ID, tripEnd, TRIP_BLOCKS.length);

  const brainEnd = insertBlocks(BRAIN_SESSION_ID, BRAIN_BLOCKS, BRAIN_START, [8000, 15000], "English", "");
  updateSession(BRAIN_SESSION_ID, brainEnd, BRAIN_BLOCKS.length);

  const studyEnd = insertBlocks(STUDY_SESSION_ID, STUDY_BLOCKS, STUDY_START, [6000, 12000], "English", "");
  updateSession(STUDY_SESSION_ID, studyEnd, STUDY_BLOCKS.length);

  const meetingEnd = insertBlocks(MEETING_SESSION_ID, MEETING_BLOCKS, MEETING_START, [5000, 10000], "English", "");
  updateSession(MEETING_SESSION_ID, meetingEnd, MEETING_BLOCKS.length);
});

insertAll();

appDb.close();

console.log("Seeded 4 demo sessions:");
console.log(`  1. Trip Planning       — ${TRIP_SESSION_ID} (${TRIP_BLOCKS.length} blocks)`);
console.log(`  2. Brainstorm          — ${BRAIN_SESSION_ID} (${BRAIN_BLOCKS.length} blocks)`);
console.log(`  3. Study Session       — ${STUDY_SESSION_ID} (${STUDY_BLOCKS.length} blocks)`);
console.log(`  4. Team Meeting        — ${MEETING_SESSION_ID} (${MEETING_BLOCKS.length} blocks)`);
