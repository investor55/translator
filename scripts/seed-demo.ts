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

function insertInsights(sessionId: string, seeds: InsightSeed[], startTs: number, gapMs: number) {
  const stmt = db.prepare(`
    INSERT INTO insights (id, kind, text, session_id, created_at)
    VALUES (?, 'key-point', ?, ?, ?)
  `);
  let ts = startTs;
  for (const seed of seeds) {
    stmt.run(randomUUID(), seed.text, sessionId, ts);
    ts += gapMs;
  }
}

function insertTasks(sessionId: string, seeds: TaskSeed[], startTs: number, gapMs: number) {
  const stmt = db.prepare(`
    INSERT INTO tasks (id, text, details, size, completed, source, created_at, session_id)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `);
  let ts = startTs;
  for (const seed of seeds) {
    stmt.run(randomUUID(), seed.text, seed.details ?? null, seed.size, seed.source, ts, sessionId);
    ts += gapMs;
  }
}

// ===========================================================================
// 1. TRIP PLANNING — Group of friends planning a Japan trip
// ===========================================================================
const TRIP_SESSION_ID = `trip-${randomUUID().slice(0, 8)}`;
const TRIP_START = BASE_TS - 45 * 60_000;

const TRIP_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay so Japan. Cherry blossom season. We're actually doing this? Like for real this time, not like the Portugal thing where we talked about it for six months and then nobody booked anything.", audioSource: "system", newTopic: true },
  { sourceText: "Yes, we're doing it. I already started looking at dates. Peak bloom in Tokyo is usually late March to early April, but it shifts year to year. The Japan Meteorological Corporation puts out forecasts starting in January.", audioSource: "mic" },
  { sourceText: "Wait who's all confirmed? It's me, you, Danny, and Priya right?", audioSource: "system" },
  { sourceText: "Priya said she's in but she needs to check something with her visa. She's on that H-1B so she might need to do the advance parole thing.", audioSource: "mic" },
  { sourceText: "Oh right. Priya can you look into that this week? I don't want a repeat of the Cancun situation.", audioSource: "system" },
  { sourceText: "Yeah I'll call my immigration lawyer Monday. Should be fine, I've traveled internationally twice this year already. But I need like three weeks lead time on the paperwork.", audioSource: "system" },
  { sourceText: "Okay so dates. I'm looking at my calendar and basically all of April works for me except the first week, I have a product launch at work.", audioSource: "mic", newTopic: true },
  { sourceText: "Danny what about you? You said something about a wedding?", audioSource: "system" },
  { sourceText: "Yeah my cousin's wedding is April 26th so I need to be back by then. But April 5th through like the 18th? That's thirteen days and I could swing it.", audioSource: "system" },
  { sourceText: "Thirteen days is kinda long for me honestly. Can we do ten? Like April 5th to the 15th?", audioSource: "mic" },
  { sourceText: "I could do April 5th to 15th. Priya?", audioSource: "system" },
  { sourceText: "Works for me assuming the visa stuff is sorted. Let's pencil that in and I'll confirm by end of next week.", audioSource: "system" },
  { sourceText: "Okay cool. April 5 to 15. Eleven days. That's actually perfect because we can do like five days Tokyo, three days Kyoto, two days Hakone or Osaka, and a travel day.", audioSource: "mic", translation: "いいね。4月5日から15日。11日間。東京5日、京都3日、箱根か大阪2日、移動日1日でちょうどいい感じ。" },
  { sourceText: "Alright flights. I've been stalking Google Flights for like two weeks now so I have opinions.", audioSource: "system", newTopic: true },
  { sourceText: "Of course you do, go ahead.", audioSource: "mic" },
  { sourceText: "So from SFO to Narita or Haneda. ANA direct is running about $920 round trip right now for those dates. JAL is similar, maybe $890. Then there's Zipair which is like $640 but it's budget — no meals, no checked bags, the seats are tighter.", audioSource: "system", translation: "SFOから成田か羽田行き。ANAの直行便が今往復920ドルくらい。JALも同じくらいで890ドルかな。あとZipairが640ドルだけどLCCだから機内食なし、受託手荷物なし、座席も狭い。" },
  { sourceText: "What about United? They fly direct to Narita too.", audioSource: "mic" },
  { sourceText: "United is like $780 but honestly ANA is so much better for transpacific. The food alone is worth the extra hundred bucks. And you get two checked bags.", audioSource: "system" },
  { sourceText: "Hold on let me check something real quick... yeah okay so if we book ANA through their website directly instead of Google Flights it's actually $870. They have a sale right now that ends next Tuesday.", audioSource: "mic" },
  { sourceText: "Oh wait seriously? $870 direct on ANA? That's actually really good. Last year those flights were like $1100.", audioSource: "system" },
  { sourceText: "Should we just all book it now? Like right now on this call? Before the sale ends?", audioSource: "system" },
  { sourceText: "I'm down. Danny, Priya, you good with ANA at $870?", audioSource: "mic" },
  { sourceText: "Yeah let's do it. Oh wait — does everyone have their passport updated? Mine doesn't expire until 2028 so I'm good.", audioSource: "system" },
  { sourceText: "Mine's good too. Priya just make sure yours has at least six months validity from the travel date, Japan requires that.", audioSource: "mic" },
  { sourceText: "Yep it's valid through 2027, we're fine. Booking now. Do we want Haneda or Narita? Haneda is way closer to the city center.", audioSource: "system", translation: "2027年まで有効だから大丈夫。今予約するね。羽田と成田どっちがいい？羽田の方が都心にずっと近いよ。" },
  { sourceText: "Haneda for sure if the price is the same. Narita to Shinjuku is like a 90-minute train ride, Haneda is 30 minutes on the monorail.", audioSource: "mic", translation: "同じ値段なら絶対羽田。成田から新宿は電車で90分くらいかかるけど、羽田ならモノレールで30分だよ。" },
  { sourceText: "Okay accommodation. This is where it gets interesting. I think we should do a mix — like regular hotel in Tokyo, ryokan in Hakone, and maybe a machiya in Kyoto?", audioSource: "system", newTopic: true },
  { sourceText: "Wait what's a machiya?", audioSource: "system" },
  { sourceText: "It's like a traditional Kyoto townhouse. You can rent the whole thing on Airbnb. Wooden interior, tatami rooms, little courtyard garden. Way cooler than a hotel and actually cheaper if you split it four ways.", audioSource: "mic", translation: "京都の伝統的な町家だよ。Airbnbで一棟丸ごと借りられるの。木造の内装、畳の部屋、小さな中庭。ホテルよりずっと雰囲気あるし、4人で割れば実は安い。" },
  { sourceText: "Oh that sounds amazing. Yes. Let's do that for Kyoto.", audioSource: "system" },
  { sourceText: "For Tokyo I was thinking Shinjuku for the hotel. It's the most central, the station connects to literally every train line, and there's a million restaurants around there.", audioSource: "mic", newTopic: true },
  { sourceText: "What about Shibuya though? It's more fun. Like the nightlife is better and it's got that whole Shibuya crossing vibe.", audioSource: "system" },
  { sourceText: "Shibuya is great to visit but Shinjuku is better as a base. Trust me. You can get to Shibuya in like seven minutes anyway, it's one stop on the JR Yamanote line.", audioSource: "mic", translation: "渋谷は遊びに行くにはいいけど、拠点としては新宿の方が便利。渋谷にはJR山手線で一駅、7分で行けるし。" },
  { sourceText: "I actually found a really good hotel in Shinjuku — the HOTEL GRACERY. It's like $120 a night per room and it's right next to Kabukicho and the east exit. Oh and it has a giant Godzilla head on the roof, which is hilarious.", audioSource: "system" },
  { sourceText: "Danny literally choosing hotels based on Godzilla statues.", audioSource: "mic" },
  { sourceText: "Hey the reviews are actually great! 4.3 on Google, super clean, good location. I'm not just picking it for the Godzilla head. ...Okay maybe like 30% for the Godzilla head.", audioSource: "system" },
  { sourceText: "Ha okay fine. That price is actually decent. Two rooms at $120 each, so $60 per person per night. For Shinjuku that's solid.", audioSource: "mic" },
  { sourceText: "OKAY but can we talk about the ryokan situation because this is what I'm most excited about.", audioSource: "system", newTopic: true },
  { sourceText: "Yes! Hakone ryokan. So I've been deep in this rabbit hole. The top tier ones like Gora Kadan are like $800 a night and you need to book months in advance.", audioSource: "mic", translation: "箱根の旅館ね。めちゃくちゃ調べたんだけど、強羅花壇みたいな高級旅館は一泊800ドルくらいで、何ヶ月も前に予約しないといけない。" },
  { sourceText: "EIGHT HUNDRED? Per person?!", audioSource: "system" },
  { sourceText: "Per room. But still, that's insane. There are really nice mid-range ones though. I found this place called Hakone Ginyu — it's $280 a night, private open-air onsen on the balcony of each room, kaiseki dinner included.", audioSource: "mic", translation: "一部屋だけどね。でもやっぱり高い。中価格帯でいい所もあるよ。箱根吟遊っていう旅館が一泊280ドルで、各部屋に露天風呂付き、懐石料理の夕食込み。" },
  { sourceText: "Did you say private onsen? On the BALCONY? Okay I'm sold.", audioSource: "system" },
  { sourceText: "Wait sorry — hold on, my dog is going absolutely insane at the mailman. BUSTER. BUSTER STOP. Sorry one sec.", audioSource: "system" },
  { sourceText: "Lol take your time.", audioSource: "mic" },
  { sourceText: "Okay I'm back. Sorry. So yeah Hakone Ginyu, $280 a night. If we do two rooms for two nights that's $1120 total, so $280 per person for two nights. That includes dinner AND breakfast.", audioSource: "system" },
  { sourceText: "That's actually really reasonable. And you literally cannot do an onsen experience anywhere else in the world so it's worth it.", audioSource: "mic" },
  { sourceText: "Oh my god okay speaking of food. We need to talk about food because I have a LIST.", audioSource: "system", newTopic: true },
  { sourceText: "Of course Danny has a list.", audioSource: "mic" },
  { sourceText: "Shut up, you'll thank me. Okay so — Tsukiji Outer Market for breakfast sushi, that's non-negotiable. Then there's this place Fuunji in Shinjuku that does insane tsukemen, the line is always around the block but it moves fast.", audioSource: "system", translation: "築地場外市場で朝の寿司、これは絶対。あと新宿の風雲児っていうつけ麺屋がヤバいんだけど、いつも行列。でも回転は早い。" },
  { sourceText: "Oh Fuunji! I've heard of that place. The broth is supposed to be this crazy thick fish-based thing right?", audioSource: "mic" },
  { sourceText: "Yes! And you dip the noodles in it. It's thick like gravy almost. Life-changing. Also Marcus told me about this tiny yakitori place under the train tracks in Yurakucho — it's called Yakitori Alley, it's like six seats and an old dude grilling chicken over charcoal.", audioSource: "system", translation: "そう！麺をつけて食べるの。とろみがグレービーみたいに濃いんだよ。人生変わる。あとマーカスが有楽町のガード下にある焼き鳥屋教えてくれた。焼き鳥横丁っていって、席が6つくらいしかなくて、おじいちゃんが炭火で鶏焼いてるの。" },
  { sourceText: "I want to do a conveyor belt sushi place too. Like the ones where the plates come around on a little train.", audioSource: "system" },
  { sourceText: "Those are called kaiten-zushi! Yeah we can do that. There's good ones in Shibuya. But honestly the random hole-in-the-wall sushi counters are even better and not much more expensive.", audioSource: "mic", translation: "回転寿司ね！渋谷にいいのあるよ。でも正直、裏通りのカウンター寿司の方が美味しいし、そんなに高くないよ。" },
  { sourceText: "What about that convenience store thing? Like everyone says 7-Eleven in Japan is actually incredible.", audioSource: "system" },
  { sourceText: "Dude yes. The onigiri, the egg sandwiches, the melon pan. Japanese convenience stores put American ones to shame. You could honestly eat like a king for $10 a day if you just did combini food.", audioSource: "mic" },
  { sourceText: "Alright alright, we'll eat everywhere. Can we circle back to the Kyoto plan though? I want to make sure we actually figure out the logistics.", audioSource: "system", newTopic: true },
  { sourceText: "Right. So Tokyo to Kyoto on the shinkansen — which by the way, the JR Pass. We need to figure that out. Danny you looked into this right?", audioSource: "mic" },
  { sourceText: "Yeah so the JR Pass changed recently. It used to be this amazing deal but they raised the prices in October 2023. A 7-day pass is now around $200 USD. The Tokyo-to-Kyoto shinkansen alone is about $130 one way, so if you're doing that round trip plus local JR lines, the pass still saves you money. But barely.", audioSource: "system" },
  { sourceText: "So we should get it right? Since we're also doing Hakone and the Yamanote line in Tokyo covers a lot.", audioSource: "mic" },
  { sourceText: "Actually hold on, the JR Pass doesn't cover the fastest Nozomi trains on the Tokaido shinkansen. You'd have to take the Hikari which is like 20 minutes slower. Is that a dealbreaker?", audioSource: "system", translation: "あ、ちょっと待って。JRパスは東海道新幹線の最速ののぞみは使えないんだよ。ひかりに乗ることになるけど、20分くらい遅い。それって問題かな？" },
  { sourceText: "Twenty minutes? No, who cares. Get the pass. The convenience of not buying individual tickets every time is worth it alone.", audioSource: "mic" },
  { sourceText: "Okay JR Pass it is. We can order them online before we go and pick them up at the station.", audioSource: "system" },
  { sourceText: "For Kyoto itself — three nights like we said. I really want to do Fushimi Inari early morning before the crowds, like 6 AM. And Arashiyama with the bamboo grove. Oh and Kinkaku-ji, obviously.", audioSource: "mic", translation: "京都は3泊で。伏見稲荷は混む前の早朝、朝6時くらいに行きたい。あと嵐山の竹林と、金閣寺はもちろん。" },
  { sourceText: "Can we do a day trip to Nara from Kyoto? I want to see the deer. I know that's touristy but I don't care, I want a deer to bow to me.", audioSource: "system" },
  { sourceText: "Nara is like 45 minutes from Kyoto by train so yeah, easy day trip. We can do Nara in a half day and then Fushimi Inari in the afternoon since it's on the way back.", audioSource: "mic" },
  { sourceText: "Oh wait actually — Priya, didn't you say you wanted to do a tea ceremony?", audioSource: "system" },
  { sourceText: "YES. That's like the one thing I absolutely must do. There's this place in Gion that does a traditional matcha tea ceremony for like $40 per person. I already bookmarked it.", audioSource: "system", translation: "そう！絶対やりたいの。祇園に伝統的な抹茶の茶道体験ができるところがあって、一人40ドルくらい。もうブックマークしてある。" },
  { sourceText: "Okay so let's talk money real quick because I want to make sure we're all on the same page.", audioSource: "mic", newTopic: true },
  { sourceText: "Yeah good call. So flights are $870 per person, locked in. What's the breakdown for everything else?", audioSource: "system" },
  { sourceText: "Let me rough it out. Hotel in Tokyo, five nights at $60 per person is $300. Machiya in Kyoto, three nights, I found one that's $200 a night for the whole house so that's $50 per person per night, $150 total. Ryokan, $280 per person for two nights.", audioSource: "mic" },
  { sourceText: "So accommodation is roughly $730 per person total?", audioSource: "system" },
  { sourceText: "Yeah. Then JR Pass is $200. Figure $50 a day for food if we mix cheap and nice meals — that's $550 for eleven days. Activities and entrance fees, maybe $150. So all-in excluding flights, we're looking at like $1630 per person.", audioSource: "mic" },
  { sourceText: "Plus the flights that's $2500 per person. That's actually very doable. I was expecting way worse.", audioSource: "system" },
  { sourceText: "We should set up a Splitwise group so we can track shared expenses. Last trip it was a nightmare trying to figure out who owed what.", audioSource: "mic" },
  { sourceText: "Already on it. I just created the group — Japan 2026. I'll add everyone.", audioSource: "system" },
  { sourceText: "Oh one more thing — should we get pocket WiFi or just do eSIM? I've heard the eSIM situation in Japan is way better now.", audioSource: "system", newTopic: true },
  { sourceText: "eSIM for sure. Ubigi or Airalo, like $15 for 10 gigs. Way easier than carrying around a pocket WiFi device.", audioSource: "mic" },
  { sourceText: "Cool. Okay I think we have a solid plan. Can someone make a shared Google Doc with the itinerary? Day by day, with the hotel bookings, train times, restaurant list, all of it.", audioSource: "system" },
  { sourceText: "I'll make the doc tonight. I'll do a rough day-by-day and then everyone can add stuff. I'll share it in the group chat.", audioSource: "mic" },
  { sourceText: "Amazing. Oh wait — Danny, what was that izakaya you kept talking about? The one in Golden Gai?", audioSource: "system" },
  { sourceText: "Oh my god yes. It's called Albatross. It's this tiny bar in Golden Gai, like literally fits maybe ten people, three floors, and the whole ceiling is covered in chandeliers. It's completely unhinged. We HAVE to go.", audioSource: "system", translation: "アルバトロスっていうの。ゴールデン街の小さなバーで、10人くらいしか入れないんだけど3階建てで、天井全部シャンデリアで覆われてる。ぶっ飛んでるよ。絶対行こう。" },
  { sourceText: "Golden Gai is that area in Shinjuku with like 200 tiny bars crammed into six alleys right? I've seen photos, it looks insane.", audioSource: "mic", translation: "ゴールデン街って新宿の6本の路地に200軒くらいの小さなバーがひしめき合ってるところだよね？写真見たことあるけど、すごそう。" },
  { sourceText: "Yep. Some of them only fit four people. It's the most Tokyo thing ever. Okay I think we're good. Let's all book the ANA flights before Tuesday, I'll send the ryokan link in the chat, and someone handle the machiya.", audioSource: "system" },
  { sourceText: "I'll book the machiya tonight. Priya, keep us posted on the visa situation. And everyone download the Navitime app for train navigation in Japan — it's way better than Google Maps for transit there.", audioSource: "mic", translation: "町家は今夜予約するね。プリヤ、ビザの件は進捗教えて。あとみんな日本の電車乗り換えにNavitimeアプリ入れといて。Google Mapsよりずっと使いやすいから。" },
  { sourceText: "This is gonna be so good. Okay I gotta go, Buster needs his walk and he's giving me the look. Talk later!", audioSource: "system" },
  { sourceText: "Bye Danny. Bye Priya. I'll have the doc ready by tonight, check the group chat.", audioSource: "mic" },
];

// ===========================================================================
// 2. RESEARCH & BRAINSTORMING — Solo founder thinking aloud
// ===========================================================================
const BRAIN_SESSION_ID = `brain-${randomUUID().slice(0, 8)}`;
const BRAIN_START = BASE_TS - 40 * 60_000;

const BRAIN_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay okay okay. So I've been noodling on this for like two weeks now and I think it's time to actually talk it out. The idea is... an AI-powered recipe and meal planning app.", audioSource: "mic", newTopic: true },
  { sourceText: "The core loop is dead simple. You open your fridge, you snap a photo, and the app figures out what you've got in there and suggests recipes you can actually make right now. No grocery run required.", audioSource: "mic" },
  { sourceText: "Like I'm staring at my fridge right now and there's... half a block of cheddar, some eggs, leftover rice from Tuesday, a sad looking bell pepper, and sriracha. What do I make? I genuinely don't know. That's the problem.", audioSource: "mic" },
  { sourceText: "But wait, hold on. Before I get excited. There are already apps doing this. Let me think through the competitive landscape because if I can't differentiate I'm dead on arrival.", audioSource: "mic", newTopic: true },
  { sourceText: "SuperCook is the obvious one. You check off ingredients you have and it matches recipes. It works but it's so... manual. You're literally scrolling through a checklist of 500 ingredients. Nobody wants to do that every time they cook.", audioSource: "mic" },
  { sourceText: "Then there's Whisk. Samsung bought them. They're more about recipe saving and meal planning but the actual intelligence layer is thin. It's basically a glorified bookmarking app with a grocery list bolted on.", audioSource: "mic" },
  { sourceText: "Mealime is interesting — they do the meal planning and dietary restriction thing pretty well actually. Clean UI, good onboarding. But they don't do the fridge scanning thing at all. It's all pre-planned meals, very structured.", audioSource: "mic" },
  { sourceText: "And Yummly, which is the big one. Tons of recipes, decent personalization, but it feels bloated. Like they're trying to be everything — social network, cooking videos, smart thermometer integration. They lost the plot a bit.", audioSource: "mic" },
  { sourceText: "So none of them are really nailing the thing I care about which is... hmm, what IS the thing I care about exactly.", audioSource: "mic" },
  { sourceText: "Okay I think it's this. The multi-household dietary restriction angle. Like in my apartment right now — I'm lactose intolerant, my girlfriend is pescatarian, and when my sister visits she's doing keto. Finding ONE meal that works for all three of us is genuinely hard.", audioSource: "mic", newTopic: true },
  { sourceText: "And that's not even a complicated household! Think about families with a kid who has a nut allergy, a parent doing Whole30, and a teenager who's just gone vegetarian. That's a real family. That's millions of families.", audioSource: "mic" },
  { sourceText: "None of the competitors handle this well. Mealime lets you set ONE dietary profile. SuperCook doesn't even think about it. The multi-profile household thing — that's the wedge. That's what makes this different.", audioSource: "mic" },
  { sourceText: "Wait no, it's even bigger than that. It's not just restrictions, it's preferences over time. Like I had Thai food three times this week, maybe don't suggest pad thai again. Or I told you last month I'm trying to eat more iron-rich foods. Remember that.", audioSource: "mic" },
  { sourceText: "It's like having a personal chef who actually knows your whole household. Okay I'm getting excited. Let me poke holes in this before I get carried away.", audioSource: "mic" },
  { sourceText: "Business model. Let me think about this seriously because 'freemium recipe app' is not exactly a sentence that makes VCs salivate.", audioSource: "mic", newTopic: true },
  { sourceText: "Option one is the obvious freemium play. Free tier gets basic recipe suggestions, maybe 10 a week. Premium at like $7.99 a month unlocks unlimited suggestions, multi-profile households, smart substitutions, full nutritional breakdown.", audioSource: "mic" },
  { sourceText: "But honestly the real money... hmm actually, the real money might be in grocery partnerships. If I know what's in your fridge and what recipe you picked, I know exactly what you need to buy. One-tap order through Instacart, Walmart, whatever. That's affiliate revenue on every single cooking session.", audioSource: "mic" },
  { sourceText: "Oh and there's a B2B angle too. Meal kit companies like HelloFresh, Blue Apron — they're spending a fortune on menu development and personalization. What if we license the dietary matching engine to them? They plug in their ingredient inventory and our algorithm optimizes their weekly menus for subscriber households.", audioSource: "mic" },
  { sourceText: "Wait, that's actually... that might be the bigger business. The consumer app is the trojan horse, the B2B licensing is where the margins are. Hmm. But that's a different company. Don't get distracted. Consumer first, prove the tech, then B2B.", audioSource: "mic" },
  { sourceText: "Okay target market. Who's the person who downloads this app day one.", audioSource: "mic", newTopic: true },
  { sourceText: "It's... honestly it's me and everyone I know. Late twenties to late thirties, dual income household or busy single professional. You care about eating well but you don't have time to meal plan. You end up ordering DoorDash three times a week and feeling guilty about it.", audioSource: "mic" },
  { sourceText: "Parents especially. Oh my god, parents. The mental load of figuring out what to feed a family every single day. I've heard so many friends complain about this. It's not the cooking that's hard, it's the deciding.", audioSource: "mic" },
  { sourceText: "Ugh, speaking of food — I haven't eaten lunch and it's 1:30. The irony of brainstorming a recipe app while I have no idea what to eat is... not lost on me. Okay focus, I'll grab something after this.", audioSource: "mic" },
  { sourceText: "Tech stack. This is the part I actually know how to think about.", audioSource: "mic", newTopic: true },
  { sourceText: "For the fridge photo recognition — I don't want to train my own model, at least not yet. There's Google Cloud Vision which is solid for general object detection. Clarifai has a specific food recognition model. And honestly GPT-4o and Claude can identify food items from photos pretty accurately now.", audioSource: "mic" },
  { sourceText: "I think for MVP I just use a multimodal LLM. Send the fridge photo, get back a structured list of identified ingredients with confidence scores. It won't be perfect but it'll be good enough to validate the concept.", audioSource: "mic" },
  { sourceText: "Recipe database is the other big piece. Spoonacular API has like 500,000 recipes with full nutritional data, dietary tags, ingredient lists. $30 a month for their starter plan. That's a no-brainer for MVP versus trying to build my own database.", audioSource: "mic" },
  { sourceText: "Hmm actually, I wonder about Spoonacular's dietary filtering though. Like can it handle 'find me a recipe that's simultaneously dairy-free AND pescatarian AND low-carb using these 8 ingredients'? I need to test that. If their API can't do compound filters I might need to build a matching layer on top.", audioSource: "mic" },
  { sourceText: "And for nutritional data beyond what Spoonacular gives me, USDA FoodData Central is free and insanely comprehensive. Like down to micronutrient levels. That's what powers the 'you should eat more iron' personalization.", audioSource: "mic" },
  { sourceText: "Oh wait, I should think about the app itself. React Native probably? Cross platform, I can ship iOS and Android from one codebase. Or... do I even need Android for launch? Maybe iOS only to start. The target demo skews iPhone.", audioSource: "mic" },
  { sourceText: "Okay MVP scope. I need to be ruthless about this because I will absolutely over-engineer it if I'm not careful.", audioSource: "mic", newTopic: true },
  { sourceText: "Core MVP features. One: photo-based ingredient detection. Two: multi-profile dietary restrictions, support at least two profiles per household. Three: recipe suggestions filtered by what you have and what everyone can eat. That's it. That's the MVP.", audioSource: "mic" },
  { sourceText: "No grocery integration. No meal planning calendar. No social features. No cooking videos. No smart kitchen device integrations. None of that. Just the core loop — photo, profiles, recipes. Ship it in six weeks.", audioSource: "mic" },
  { sourceText: "Hmm actually... is six weeks realistic? Photo recognition integration, dietary profile system, recipe matching engine, basic UI. For a solo dev working full time on it... yeah, six weeks is tight but doable if I don't get precious about the UI.", audioSource: "mic" },
  { sourceText: "Wait, is anyone actually going to want this? Like I keep saying 'this is a problem' but is it MY problem or is it A problem? Maybe I'm just bad at cooking and everyone else is fine.", audioSource: "mic" },
  { sourceText: "No. No, I've literally heard this complaint from like fifteen different people in the last month. And the 'what's for dinner' search term gets insane Google volume. This is real. Don't talk yourself out of it. Keep going.", audioSource: "mic" },
  { sourceText: "Names. I hate naming things but let me just brainstorm for a second. FridgeAI — no, that's terrible and too literal. PantryPal — too cutesy. CookSmart — probably taken. Mise, like mise en place? That's actually not bad. Short, food-related, implies preparation.", audioSource: "mic", newTopic: true },
  { sourceText: "Or Supper. Simple, warm, approachable. 'What should we have for Supper?' That works as a sentence. Okay I like Supper and Mise. I'll check the domains later.", audioSource: "mic" },
  { sourceText: "Go-to-market. I'm not going to do paid ads at launch, that's burning money. The play is food TikTok and Instagram Reels. Record myself opening my fridge, using the app, cooking what it suggests. The before and after is inherently visual and shareable.", audioSource: "mic", newTopic: true },
  { sourceText: "Also Product Hunt launch, obviously. And I should find like 50 food bloggers and mommy bloggers and offer them free premium for a year in exchange for an honest review. User-generated content is the engine here.", audioSource: "mic" },
  { sourceText: "Pricing at launch. Free tier with 5 recipe lookups per week, enough to get hooked. Premium at $5.99 a month or $49.99 a year. The annual plan is the real target — that's where retention lives.", audioSource: "mic" },
  { sourceText: "Oh and a family plan. $8.99 a month for up to 6 profiles. That's the multi-household angle monetized directly. Actually wait, should the multi-profile thing be premium only? That's literally the differentiator... but if it's locked behind a paywall people won't experience what makes us different.", audioSource: "mic" },
  { sourceText: "Okay compromise. Free gets two profiles. Premium gets six. That way a couple can try the multi-profile thing for free but a full family needs to upgrade. Yeah, that feels right.", audioSource: "mic" },
  { sourceText: "Alright. Next steps. This week I need to do three things. One, build a quick prototype of the photo recognition with Claude's API, just to see how good the ingredient detection actually is. Two, interview ten people — five parents, five young professionals — about how they decide what to cook. And three, check if supper.app or mise.app domains are available.", audioSource: "mic" },
  { sourceText: "Going back to the B2B thing for a second — I keep thinking about it. If I build this dietary matching engine right, with the multi-profile constraint satisfaction... that's genuinely hard technology. That's defensible IP. The consumer app might be the easy part and the engine underneath might be the actual company. Just... filing that thought away for now.", audioSource: "mic" },
  { sourceText: "Okay I think that's enough for today. I'm going to go make lunch. Probably just eggs and rice since that's what's in the fridge. God I really do need this app.", audioSource: "mic" },
];

// ===========================================================================
// 3. STUDY SESSION — Two CS students on distributed systems
// ===========================================================================
const STUDY_SESSION_ID = `study-${randomUUID().slice(0, 8)}`;
const STUDY_START = BASE_TS - 35 * 60_000;

const STUDY_BLOCKS: BlockSeed[] = [
  // --- Raft consensus: leader election ---
  { sourceText: "Alright, exam is Thursday. I'm honestly kind of freaking out. Where do you wanna start?", audioSource: "system", newTopic: true },
  { sourceText: "Let's start with Raft since that's probably the biggest chunk of the exam. You good on leader election?", audioSource: "mic" },
  { sourceText: "Uh, kind of? I know there's like terms and heartbeats and stuff. Walk me through it?", audioSource: "system" },
  { sourceText: "Okay so in Raft, every node is in one of three states: follower, candidate, or leader. They all start as followers. The leader sends periodic heartbeats to maintain authority. If a follower doesn't hear from the leader before its election timeout, it promotes itself to candidate, increments its term, votes for itself, and sends RequestVote RPCs to everyone else. You need a strict majority to win.", audioSource: "mic" },
  { sourceText: "Wait, what happens if two nodes both become candidates at the same time? Like a split vote?", audioSource: "system" },
  { sourceText: "That's why Raft uses randomized election timeouts — each node picks a random timeout between like 150 and 300 milliseconds, so it's unlikely two nodes time out simultaneously. But if they do split the vote, the term ends with no winner and they retry with new random timeouts. The key safety property is at most one leader per term.", audioSource: "mic" },
  { sourceText: "Oh that's actually clever. It's like... a voting system but for computers. And the randomization breaks ties.", audioSource: "system" },
  // --- Raft: log replication and safety ---
  { sourceText: "Okay what about log replication though? That's the part I always mix up.", audioSource: "system", newTopic: true },
  { sourceText: "So once you have a leader, all client writes go through it. The leader appends the entry to its log, sends AppendEntries RPCs to all followers, and once a majority acknowledges, the entry is committed. Committed means safe — even if the leader crashes, the new leader is guaranteed to have it.", audioSource: "mic" },
  { sourceText: "Wait, why is that guaranteed? What if a node that DOESN'T have the entry wins the election?", audioSource: "system" },
  { sourceText: "It can't! That's the beautiful part. The RequestVote RPC includes the candidate's log info, and followers reject votes from candidates whose logs are less up-to-date. So the winner always has the most complete committed log.", audioSource: "mic" },
  { sourceText: "Ohhhh THAT'S what the election restriction is for. Okay that just clicked for me. The professor's slides made it seem way more complicated than it is.", audioSource: "system" },
  { sourceText: "Dude the professor's slides are so bad. Half of them are just screenshots of the paper with no explanation.", audioSource: "mic" },
  // --- Paxos and why it's confusing ---
  { sourceText: "Speaking of bad explanations, can we talk about Paxos? Because I've read the paper twice and I still feel like I'm missing something.", audioSource: "system", newTopic: true },
  { sourceText: "Okay so Paxos has three roles: proposers, acceptors, and learners. A proposer picks a proposal number, does a prepare phase to check if any value has already been accepted, then does an accept phase to commit. Unlike Raft's strong leader, any node can propose.", audioSource: "mic" },
  { sourceText: "So it's two phases? Like two-phase commit?", audioSource: "system" },
  { sourceText: "No no, don't confuse those! Two-phase commit is for distributed transactions, totally different — we'll get to it. Paxos's prepare phase discovers what's already been decided, the accept phase proposes a value. The proposal numbers create a total ordering — if a proposer finds a value was already accepted, it MUST propose that value, not its own. That's what preserves consistency.", audioSource: "mic" },
  { sourceText: "I think the reason everyone says Paxos is confusing is that Lamport wrote the paper as this weird parable about a Greek parliament. And then 'Paxos Made Simple' starts with 'The Paxos algorithm is simple' and proceeds to not be simple at all. Like why.", audioSource: "system" },
  { sourceText: "Yeah the whole reason Raft exists is because grad students couldn't implement Paxos correctly. Ongaro and Ousterhout literally did a study showing students learned Raft faster and implemented it with fewer bugs.", audioSource: "mic" },
  // --- CAP theorem with real examples ---
  { sourceText: "Alright let's move to CAP. I think I get the basics but I always mess up the real-world examples.", audioSource: "system", newTopic: true },
  { sourceText: "So the theorem says in the presence of a network partition, you have to choose between consistency and availability. What trips people up is it's not about choosing two out of three in normal operation — it's specifically about what happens during a partition. Since partitions always happen in distributed systems, you're really choosing between C and A.", audioSource: "mic" },
  { sourceText: "Right. So DynamoDB is AP — stays available during partitions but might serve stale reads. And Google Spanner is CP because of TrueTime with the atomic clocks, and it'll refuse requests rather than serve inconsistent data?", audioSource: "system" },
  { sourceText: "Exactly. And here's where you messed up on the homework — you wrote that Cassandra was CP, but it's AP by default with tunable consistency. You can configure quorum reads and writes to make it more CP-like, but out of the box it prioritizes availability. That's probably why you lost points.", audioSource: "mic" },
  // --- Vector clocks worked example ---
  { sourceText: "Okay let's do vector clocks. Can we work through an actual example? I need to see concrete numbers or I won't remember it.", audioSource: "system", newTopic: true },
  { sourceText: "Sure. Three nodes: A, B, C, everyone starts at [0, 0, 0]. Node A does a local event, clock becomes [1, 0, 0]. A sends a message to B. When B receives it, B takes the element-wise max of its own clock and the incoming one, then increments its own position. So B goes [0, 0, 0] max with [1, 0, 0] gives [1, 0, 0], then increments to [1, 1, 0].", audioSource: "mic" },
  { sourceText: "Okay now what if C does a local event independently? Its clock goes to [0, 0, 1]. And then comparing B's [1, 1, 0] with C's [0, 0, 1]... B is higher in positions 0 and 1, C is higher in position 2. So they're concurrent?", audioSource: "system" },
  { sourceText: "Yes! Neither vector dominates the other, so they're concurrent events. If one is greater-than-or-equal in ALL positions, it happened after. Otherwise concurrent. That's the whole insight — Lamport clocks give a partial order but can't detect concurrency. Vector clocks can, which is why Dynamo used them.", audioSource: "mic" },
  { sourceText: "OH. Okay I was overcomplicating this. It's literally just element-wise comparison.", audioSource: "system" },
  // --- Byzantine fault tolerance ---
  { sourceText: "Okay, BFT time. This is the one that scares me. Nodes can actively lie right? How many faulty nodes can you even tolerate?", audioSource: "system", newTopic: true },
  { sourceText: "So Byzantine faults are the worst case — nodes can crash, lie, send contradictory messages to different peers, even collude. You need 3f plus 1 total nodes to tolerate f Byzantine faults. The faulty node can say one thing to one group and something different to another, so you need enough honest nodes to outvote the liars even in the worst case.", audioSource: "mic" },
  { sourceText: "That's so expensive compared to crash fault tolerance where you only need 2f plus 1. Like you're adding a whole extra f nodes just to handle lying.", audioSource: "system" },
  { sourceText: "Yeah and that's why most practical systems like etcd and ZooKeeper just use Raft for crash faults. You trust the nodes in your own data center. BFT is more relevant for blockchain and adversarial environments where you can't trust participants.", audioSource: "mic" },
  // --- Tangent: other class, TA complaint, time check ---
  { sourceText: "Makes sense. Oh by the way, did you finish the OS homework? The one on page tables? I haven't even started and it's due Friday.", audioSource: "system" },
  { sourceText: "Ugh don't remind me. Also the TA's grading on the last assignment was insane — I lost 5 points because I didn't 'show enough intermediate steps' on the TLB question. I literally showed the correct answer! What more do you want from me.", audioSource: "mic" },
  { sourceText: "Ha yeah that TA is brutal. Okay wait, what time is it... dude it's been two hours already. We should speed through the last few topics though.", audioSource: "system" },
  // --- Consistent hashing, gossip protocols ---
  { sourceText: "Alright, consistent hashing. You hash keys and servers onto a ring, each key goes to the next server clockwise. When you add or remove a node, only keys between it and its predecessor move — unlike naive hashing where you'd rehash everything. Virtual nodes fix uneven distribution by giving each server like 200 points on the ring.", audioSource: "mic", newTopic: true },
  { sourceText: "Got it. What about gossip protocols, that's how nodes share state without a coordinator right? Each node picks a random peer and exchanges info, spreads exponentially?", audioSource: "system" },
  { sourceText: "Yep, O of log n rounds to reach all nodes. Cassandra uses it for failure detection — each node gossips its heartbeat and if it stops updating, others mark it down. No single point of failure.", audioSource: "mic" },
  // --- Two-phase commit and exam hints ---
  { sourceText: "Okay last thing — two-phase commit. You said earlier not to confuse it with Paxos. What's the actual problem with 2PC?", audioSource: "system", newTopic: true },
  { sourceText: "2PC is for distributed transactions. Phase one the coordinator asks 'can you commit', phase two it sends the decision. The fatal flaw is it's blocking — if the coordinator crashes between phases, all participants are stuck holding locks, waiting for a decision that may never come. Three-phase commit adds a pre-commit phase to fix that, but it breaks under network partitions, so in practice people just use 2PC with a persistent transaction log.", audioSource: "mic" },
  { sourceText: "One more thing — remember the professor said 'pay attention to the assumptions each algorithm makes about the failure model'? That's gotta be a huge exam hint. Raft assumes crash-stop, BFT assumes arbitrary faults, 2PC assumes a reliable coordinator. She also said 'know the tradeoffs, not just the mechanisms.'", audioSource: "system" },
  { sourceText: "Yeah I bet there'll be a compare-and-contrast question. Like 'when would you choose Raft over Paxos' or 'why is 2PC unsuitable for wide-area networks.' Okay I feel maybe 60% ready. Let's do another session tomorrow? I still can't get step 3 on that homework problem about the replicated state machine losing quorum during a partition.", audioSource: "mic" },
  { sourceText: "Oh that one took me forever. The trick is that uncommitted entries CAN be overwritten by a new leader — people assume everything in the log is safe, but only committed entries are guaranteed. I'll send you my solution tonight so you can compare. We got this.", audioSource: "system" },
];

// ===========================================================================
// 4. TEAM MEETING — Engineering standup / sprint planning
// ===========================================================================
const MEETING_SESSION_ID = `meeting-${randomUUID().slice(0, 8)}`;
const MEETING_START = BASE_TS - 30 * 60_000;

const MEETING_BLOCKS: BlockSeed[] = [
  // --- Sprint review: what shipped ---
  { sourceText: "Alright let's get started. I think we're still waiting on Marcus but let's not hold up. Sprint review first, then planning. Sarah, you wanna kick us off?", audioSource: "mic", newTopic: true },
  { sourceText: "Sure thing. So the big one this sprint was the OAuth2 flow. It's fully implemented — Google, GitHub, and email magic links all working. It's behind a feature flag right now. I also fixed that race condition in the session middleware that was causing the intermittent 401s.", audioSource: "system" },
  { sourceText: "Nice. How confident are we on the token refresh logic? That was the piece I was worried about.", audioSource: "mic" },
  { sourceText: "Honestly, the happy path is solid. The thing I'm less sure about is when users have like four tabs open and the refresh token rotates. I wrote tests for it but I want to do some manual testing with the devtools throttling.", audioSource: "system" },
  { sourceText: "Can you hear me? Sorry, my mic was being weird. Did I miss anything?", audioSource: "system" },
  { sourceText: "Hey Priya. No we just started, Sarah was going through her sprint items. Go ahead Sarah.", audioSource: "mic" },
  { sourceText: "Yeah that was basically it. OAuth2 plus the session fix. Oh and I reviewed Jake's Stripe PR but I have some comments on it still.", audioSource: "system" },
  // --- Jake's update: Stripe + blocker ---
  { sourceText: "Cool, we'll come back to that PR. Jake, what about you?", audioSource: "mic", newTopic: true },
  { sourceText: "So Stripe integration is mostly done. Subscriptions, checkout flow, webhook handling — all working. The invoicing piece is where I'm stuck though. Legal still hasn't signed off on our tax calculation approach and I literally cannot ship without that.", audioSource: "system" },
  { sourceText: "That's been sitting for over a week now. I'll escalate it today. When they unblock you, how long to finish?", audioSource: "mic" },
  { sourceText: "Two days max. The code is written, I just need to plug in their approved tax rates and run the integration tests against the staging Stripe account.", audioSource: "system" },
  { sourceText: "Got it. Priya, how's the dashboard redesign?", audioSource: "mic" },
  { sourceText: "So the new dashboard UI is done, the component library migration went pretty smoothly. But I need to flag something — the analytics page is really slow. Like 8 seconds to load on staging. I profiled it and it's mostly the API response time, not the frontend.", audioSource: "system" },
  { sourceText: "Yeah that query is a disaster. It's doing 6 joins across three tables with no caching. I've been saying we need to fix that for two sprints now.", audioSource: "mic" },
  // --- Marcus joins late ---
  { sourceText: "Hey sorry I'm late, I was on a call with the investor update people. What did I miss?", audioSource: "system" },
  { sourceText: "Hey Marcus. Sprint review — Sarah shipped OAuth2, Jake's blocked on Stripe invoicing waiting for legal, Priya finished the dashboard redesign but we have a perf issue on analytics. We were just about to dig into that.", audioSource: "mic" },
  { sourceText: "Got it. Quick question — when we say the dashboard is slow, is that something customers have noticed or is it just internal?", audioSource: "system" },
  { sourceText: "Customers are complaining. We got three support tickets last week about it. One of them was from that enterprise prospect, the fintech company.", audioSource: "mic" },
  { sourceText: "Oh yikes. Okay yeah that needs to be top priority then.", audioSource: "system" },
  // --- Sprint planning: priorities ---
  { sourceText: "Agreed. So that actually transitions us into planning. Let me lay out what I'm thinking for next sprint priorities.", audioSource: "mic", newTopic: true },
  { sourceText: "Number one, OAuth2 rollout — remove the feature flag, roll out to 100% of users. Sarah, that's yours. Number two, dashboard performance fix. Number three, Stripe invoicing once legal unblocks Jake. And four, we need an API migration guide for the auth changes since it's a breaking change for integrators.", audioSource: "mic" },
  // --- Technical debate: Redis vs materialized views ---
  { sourceText: "For the dashboard perf, I think we have two options. We either add Redis caching in front of the analytics queries, or we set up materialized views in Postgres and refresh them on a schedule.", audioSource: "system" },
  { sourceText: "I'd lean toward materialized views honestly. Redis adds operational complexity — another service to monitor, cache invalidation headaches, one more thing to break at 2 AM.", audioSource: "mic" },
  { sourceText: "But materialized views have staleness issues. If someone creates a new record and checks analytics immediately, they won't see it. At least with Redis we control the TTL precisely.", audioSource: "system" },
  { sourceText: "How often do people actually check analytics right after creating records though? I feel like that's an edge case we're over-indexing on.", audioSource: "mic" },
  { sourceText: "Marcus is that something you have data on? Like how frequently users are hitting the analytics page?", audioSource: "system" },
  { sourceText: "Uh, I can pull that from Mixpanel. Give me a sec... actually let's take that offline, I don't wanna derail the whole meeting. I'll send the data to Slack after.", audioSource: "system" },
  { sourceText: "Fair enough. Let's go with materialized views as the default plan, and if the staleness is a real problem we can layer Redis on top later. Sarah, you wanna own this since you're lighter after OAuth ships?", audioSource: "mic" },
  { sourceText: "Yeah I can take it. I've been wanting to clean up those queries anyway. Some of them are... I mean, we wrote them during the hackathon and they show it.", audioSource: "system" },
  // --- Tech debt discussion ---
  { sourceText: "That actually brings up something I keep wanting to raise. We have a LOT of tech debt from that hackathon era. The analytics queries are just one example. The notification system is held together with duct tape, the job queue has no retry logic, and half our error handling is just console.log and pray.", audioSource: "system", newTopic: true },
  { sourceText: "You're right and we keep punting it. This is the third sprint in a row someone's brought up the job queue.", audioSource: "mic" },
  { sourceText: "Can we at least allocate like 20% of the sprint to tech debt? Just carve it out so it doesn't keep getting deprioritized every time a customer issue comes up.", audioSource: "system" },
  { sourceText: "I'm fine with that. Marcus, does that work from a product perspective?", audioSource: "mic" },
  { sourceText: "I mean, as long as the OAuth rollout and the dashboard fix ship on time, I don't care how you allocate the rest. Just keep me in the loop if timelines slip.", audioSource: "system" },
  // --- Incident postmortem ---
  { sourceText: "Oh speaking of things slipping — we need to do a postmortem on last Wednesday's incident. The one where the webhook processor went down for 45 minutes and we lost a batch of Stripe events.", audioSource: "mic", newTopic: true },
  { sourceText: "Yeah that was my fault. I deployed a migration that locked the webhooks table and the queue backed up. I already wrote up a draft postmortem, I'll share it today.", audioSource: "system" },
  { sourceText: "No blame, we just need to make sure it doesn't happen again. Did we recover all the events?", audioSource: "mic" },
  { sourceText: "We did. Stripe has that event replay feature so we re-fetched everything. But it exposed that we don't have any alerting on queue depth. I literally didn't know it was down until a customer emailed.", audioSource: "system" },
  // --- Monitoring: Datadog vs Grafana ---
  { sourceText: "Which brings us back to the monitoring conversation. Are we finally going to decide on Datadog versus Grafana? This has been punted three sprints running.", audioSource: "mic", newTopic: true },
  { sourceText: "I've been running both in staging for the last two weeks. Datadog's APM tracing is significantly better. The auto-instrumentation just works. With Grafana we're spending like half a day a week maintaining dashboards.", audioSource: "system" },
  { sourceText: "What's the cost difference?", audioSource: "system" },
  { sourceText: "Datadog is about $23 per host per month for APM. We have 6 hosts so that's like $140 a month. Grafana Cloud is cheaper on paper but when you factor in the engineering time we spend on it, Datadog wins.", audioSource: "mic" },
  { sourceText: "I vote Datadog. Let's just commit and stop having this conversation every two weeks.", audioSource: "system" },
  { sourceText: "Agreed. Jake, can you set up the initial Datadog integration as a stretch goal this sprint? If Stripe wraps up early.", audioSource: "mic" },
  // --- Jake's PR that's been sitting ---
  { sourceText: "Sure. I'll timebox it to a day. Oh also — has anyone looked at my PR for the rate limiter? It's been open for three days and I haven't gotten a single review.", audioSource: "system", newTopic: true },
  { sourceText: "That's on me, sorry. I started reviewing it Monday but then got pulled into the incident. I'll finish the review today, I promise.", audioSource: "system" },
  { sourceText: "I also left a few comments on it yesterday Jake, did you see those?", audioSource: "mic" },
  { sourceText: "Oh I didn't, let me check... yeah I see them now. The one about using a sliding window instead of fixed window — that's a good call, I'll update it.", audioSource: "system" },
  // --- Hiring discussion ---
  { sourceText: "One more thing before we wrap. We really need another backend engineer. Sarah's been carrying the entire backend alone and it's not sustainable, especially with the API migration coming up.", audioSource: "mic", newTopic: true },
  { sourceText: "Completely agree. I love my job but I'm basically a single point of failure right now. If I go on vacation the backend just... doesn't move.", audioSource: "system" },
  { sourceText: "I can open the req today. Do we want senior or mid-level? Senior is going to take longer to fill.", audioSource: "system" },
  { sourceText: "Mid-level is fine if they're strong on Node and Postgres. We can mentor them up. A senior would be nice but we've been trying to hire a senior for four months with no luck.", audioSource: "mic" },
  { sourceText: "I can help with the take-home project review if we get candidates. I actually kind of enjoy those... wait no, I take that back, last time I reviewed twelve of them in a weekend. Never again.", audioSource: "system" },
  { sourceText: "Ha. Okay, I'll put the req up and we'll split the review load evenly this time. Any other business before we wrap?", audioSource: "mic" },
  // --- Snack tangent + wrap-up ---
  { sourceText: "Oh wait — completely unrelated but did anyone see the email about the office snack order? They're replacing all the good stuff with those organic rice cakes again. Someone needs to push back on that.", audioSource: "system" },
  { sourceText: "I will literally fight for the Goldfish crackers. But yeah, not a meeting topic. I'll reply to the email.", audioSource: "mic" },
  { sourceText: "Alright, to summarize. Sarah: OAuth rollout plus dashboard perf with materialized views. Jake: finish Stripe invoicing, review cycle on the rate limiter PR, stretch goal on Datadog. Priya: frontend polish on dashboard, help with tech debt backlog. I'll handle the migration guide, escalate legal, and open the backend eng req. Everyone good?", audioSource: "mic" },
  { sourceText: "Sounds good to me.", audioSource: "system" },
  { sourceText: "Yep. Oh and don't forget to share that postmortem Jake.", audioSource: "system" },
  { sourceText: "Will do. Sending it right after this call.", audioSource: "system" },
  { sourceText: "Great. Good sprint everyone. Let's crush it this week.", audioSource: "mic" },
];

// ===========================================================================
// KEY POINTS (insights) — populate the Briefing panel
// ===========================================================================
type InsightSeed = { text: string };
type TaskSeed = { text: string; details?: string; size: "small" | "large"; source: "ai" | "manual" };

const TRIP_INSIGHTS: InsightSeed[] = [
  { text: "Group targeting April 5-15 for a 10-day Japan trip during cherry blossom season" },
  { text: "Flight options from SFO: ANA ~$870 round-trip, JAL ~$890, Zipair budget ~$640, United ~$780" },
  { text: "Budget agreed at $2,500 per person excluding flights, covering hotels, food, trains, activities" },
  { text: "Itinerary plan: 4-5 nights Tokyo (Shinjuku), 3 nights Kyoto, 1-2 nights Hakone ryokan" },
  { text: "7-day JR Pass costs around $200 and covers shinkansen between cities (Hikari, not Nozomi)" },
  { text: "Priya may need advance parole document for H-1B visa re-entry — needs to check with immigration lawyer" },
  { text: "Ryokan in Hakone targeted under $250/night with onsen; booking early is key" },
  { text: "Must-visit food spots: Fuunji tsukemen in Shinjuku, Yakitori Alley in Yurakucho, kaiten-zushi in Shibuya" },
  { text: "Kyoto highlights: Fushimi Inari early morning, Arashiyama bamboo grove, possible Nara day trip" },
  { text: "Danny volunteered to create shared Google Doc for itinerary; Splitwise group for cost splitting" },
];

const BRAIN_INSIGHTS: InsightSeed[] = [
  { text: "Core product: AI recipe app that identifies fridge contents from photos and suggests meals matching household dietary restrictions" },
  { text: "Key differentiator: multi-profile households — one meal that works for lactose intolerant, vegetarian, keto, etc. simultaneously" },
  { text: "Competitive landscape: SuperCook (manual, no AI), Whisk (bookmarking), Mealime (no fridge scan), Yummly (bloated)" },
  { text: "Business model: freemium consumer app ($5.99/mo) + grocery affiliate revenue (Instacart/Walmart) + B2B licensing to meal kit companies" },
  { text: "MVP scope: photo ingredient detection, 2-profile dietary restrictions, recipe matching — ship in 6 weeks" },
  { text: "Tech stack: multimodal LLM for food recognition, Spoonacular API for recipes ($30/mo), USDA FoodData Central for nutrition" },
  { text: "Target market: dual-income households 25-40, parents overwhelmed by daily meal decisions" },
  { text: "Pricing: free tier (5 lookups/week, 2 profiles), premium $5.99/mo (unlimited, 6 profiles), annual $49.99" },
  { text: "Top name candidates: 'Mise' (mise en place) and 'Supper' — need to check domain availability" },
  { text: "Go-to-market: food TikTok/Reels content, Product Hunt launch, 50 food blogger partnerships" },
];

const STUDY_INSIGHTS: InsightSeed[] = [
  { text: "Raft uses strong leader model — all writes go through leader; leader election uses randomized timeouts to avoid split votes" },
  { text: "Raft log replication: leader sends AppendEntries, needs majority acknowledgment before committing; election restriction ensures new leader has all committed entries" },
  { text: "Paxos has three roles (proposer, acceptor, learner) with prepare/accept phases — fundamentally different from 2PC despite sounding similar" },
  { text: "CAP theorem: choose between Consistency and Availability during partitions. DynamoDB/Cassandra = AP, Spanner = CP" },
  { text: "Vector clocks: each node maintains counter vector; compare element-wise — if neither dominates, events are concurrent (unlike Lamport clocks which only give partial ordering)" },
  { text: "Byzantine fault tolerance requires 3f+1 nodes to tolerate f faults — much more expensive than crash fault tolerance (2f+1)" },
  { text: "Consistent hashing: ring structure with virtual nodes for load balancing; gossip protocols converge in O(log n) rounds" },
  { text: "2PC is blocking — if coordinator crashes after prepare, participants are stuck. 3PC adds pre-commit phase but requires no network partitions" },
  { text: "Exam likely to include compare-and-contrast question on failure model assumptions (crash vs Byzantine vs omission)" },
];

const MEETING_INSIGHTS: InsightSeed[] = [
  { text: "Sarah shipped OAuth2 flow with Google, GitHub, and email magic link — currently behind feature flag, ready for 100% rollout" },
  { text: "Token refresh with multiple tabs open is a known edge case in the OAuth2 implementation — filed for next sprint" },
  { text: "Jake's Stripe payment integration is blocked on legal sign-off for tax calculation approach — has been waiting a week" },
  { text: "Dashboard analytics page taking 8 seconds to load — query doing 6 joins with no caching. Sarah will take the perf fix." },
  { text: "Decision made: adopting Datadog over Grafana for monitoring — better APM tracing, acceptable cost at current scale" },
  { text: "Webhook processor outage last Tuesday: failed silently for 90 minutes because no alerting on queue depth" },
  { text: "Background job queue tech debt has been punted for three consecutive sprints — becoming a reliability risk" },
  { text: "Jake's auth middleware PR has been open for 3 days unreviewed — team agreed to 24-hour review SLA going forward" },
  { text: "Sarah identified as single point of failure for backend — team discussed hiring senior backend engineer" },
  { text: "Sprint plan: Sarah → OAuth rollout + dashboard perf, Jake → Stripe invoicing + Datadog setup (stretch), migration guide by Wednesday" },
];

// ===========================================================================
// TASKS — populate the Work panel
// ===========================================================================
const TRIP_TASKS: TaskSeed[] = [
  { text: "Book round-trip flights SFO → NRT for April 5-15", details: "Compare ANA ($870), JAL ($890), Zipair ($640), United ($780). Group prefers ANA or JAL for comfort but open to budget if savings are significant. Need to book before prices increase.", size: "large", source: "ai" },
  { text: "Reserve ryokan in Hakone for 2 nights", details: "Budget under $250/night. Must have private onsen. Look at Hakone Ginyu, Yama no Chaya, Senkyoro. Book early for April availability.", size: "large", source: "ai" },
  { text: "Create shared Google Doc for trip itinerary", details: "Danny volunteered. Include: daily schedule, hotel bookings, restaurant reservations, transportation (JR Pass), budget tracker, packing list.", size: "small", source: "ai" },
  { text: "Check advance parole requirements for H-1B re-entry", details: "Priya needs to verify with immigration lawyer whether she needs advance parole to re-enter US on H-1B after Japan trip. Time-sensitive — may affect whether she can join.", size: "large", source: "ai" },
];

const BRAIN_TASKS: TaskSeed[] = [
  { text: "Build photo recognition prototype with Claude API", details: "Quick prototype to test ingredient detection accuracy from fridge photos. Use Claude's vision capabilities. Measure: how many ingredients correctly identified, false positives, missed items.", size: "large", source: "ai" },
  { text: "Interview 10 target users about meal planning pain points", details: "5 parents, 5 young professionals. Key questions: how they decide what to cook, biggest frustrations, would multi-profile dietary matching change their behavior, willingness to pay.", size: "large", source: "ai" },
  { text: "Check domain availability for supper.app and mise.app", details: "Also check mise.co, getsupper.com, supperapp.com as fallbacks. Register if available and under $50.", size: "small", source: "ai" },
  { text: "Test Spoonacular API compound dietary filtering", details: "Specifically test: can it handle 'dairy-free AND pescatarian AND low-carb' simultaneously? If not, need to build matching layer on top. Document API limitations.", size: "large", source: "ai" },
];

const STUDY_TASKS: TaskSeed[] = [
  { text: "Create Raft vs Paxos vs ZAB comparison table", details: "Cover: leader model, fault tolerance, message complexity, liveness guarantees, real-world implementations (etcd, ZooKeeper, Chubby). Focus on what the exam would ask.", size: "large", source: "ai" },
  { text: "Do practice problems from week 8 problem set", details: "Focus on vector clock exercises and consensus scenarios. Alex will send the problem set. Work through independently then compare answers.", size: "large", source: "manual" },
  { text: "Review Byzantine fault tolerance section", details: "Professor hinted this will be on the exam. Cover: BFT vs CFT, 3f+1 requirement proof intuition, PBFT basics, why most practical systems avoid BFT.", size: "large", source: "ai" },
  { text: "Solve the uncommitted log entry problem from homework", details: "The scenario where a leader crashes after replicating to minority. Need to trace through what happens during re-election and how the new leader handles the uncommitted entry.", size: "small", source: "manual" },
];

const MEETING_TASKS: TaskSeed[] = [
  { text: "Roll out OAuth2 to 100% of users", details: "Remove feature flag, monitor error rates and login success metrics for 48 hours. Have rollback plan ready. Sarah owns this.", size: "large", source: "ai" },
  { text: "Fix dashboard analytics page performance", details: "Currently 8 seconds load time. Options: Redis caching layer, materialized view for aggregates, or query optimization. Sarah taking this — target sub-2-second load.", size: "large", source: "ai" },
  { text: "Complete Stripe invoicing integration", details: "Blocked on legal sign-off for tax calculation. Once unblocked, swap in real tax rates and test with approved config. Jake estimates 2 days of work.", size: "large", source: "ai" },
  { text: "Write API migration guide for auth changes", details: "Document breaking changes in auth flow for API consumers. Sarah to draft by Wednesday. Include: new endpoints, token format changes, migration steps.", size: "large", source: "ai" },
  { text: "Set up Datadog initial integration", details: "Jake's stretch goal. Install agent, configure APM tracing, set up basic dashboards for API latency and error rates. Timebox to 1 day.", size: "large", source: "ai" },
  { text: "Add alerting on webhook processor queue depth", details: "Post-incident action item from Tuesday's outage. Need alerts when queue depth exceeds threshold. Prevents silent failures.", size: "small", source: "ai" },
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

  // Insert blocks, insights, tasks and update session end times + block counts
  const tripEnd = insertBlocks(TRIP_SESSION_ID, TRIP_BLOCKS, TRIP_START, [5000, 10000], "English", "Japanese");
  insertInsights(TRIP_SESSION_ID, TRIP_INSIGHTS, TRIP_START + 3 * 60_000, 90_000);
  insertTasks(TRIP_SESSION_ID, TRIP_TASKS, TRIP_START + 5 * 60_000, 120_000);
  updateSession(TRIP_SESSION_ID, tripEnd, TRIP_BLOCKS.length);

  const brainEnd = insertBlocks(BRAIN_SESSION_ID, BRAIN_BLOCKS, BRAIN_START, [8000, 15000], "English", "");
  insertInsights(BRAIN_SESSION_ID, BRAIN_INSIGHTS, BRAIN_START + 4 * 60_000, 120_000);
  insertTasks(BRAIN_SESSION_ID, BRAIN_TASKS, BRAIN_START + 6 * 60_000, 150_000);
  updateSession(BRAIN_SESSION_ID, brainEnd, BRAIN_BLOCKS.length);

  const studyEnd = insertBlocks(STUDY_SESSION_ID, STUDY_BLOCKS, STUDY_START, [6000, 12000], "English", "");
  insertInsights(STUDY_SESSION_ID, STUDY_INSIGHTS, STUDY_START + 3 * 60_000, 100_000);
  insertTasks(STUDY_SESSION_ID, STUDY_TASKS, STUDY_START + 5 * 60_000, 120_000);
  updateSession(STUDY_SESSION_ID, studyEnd, STUDY_BLOCKS.length);

  const meetingEnd = insertBlocks(MEETING_SESSION_ID, MEETING_BLOCKS, MEETING_START, [5000, 10000], "English", "");
  insertInsights(MEETING_SESSION_ID, MEETING_INSIGHTS, MEETING_START + 2 * 60_000, 80_000);
  insertTasks(MEETING_SESSION_ID, MEETING_TASKS, MEETING_START + 4 * 60_000, 100_000);
  updateSession(MEETING_SESSION_ID, meetingEnd, MEETING_BLOCKS.length);
});

insertAll();

appDb.close();

console.log("Seeded 4 demo sessions:");
console.log(`  1. Trip Planning       — ${TRIP_SESSION_ID} (${TRIP_BLOCKS.length} blocks, ${TRIP_INSIGHTS.length} insights, ${TRIP_TASKS.length} tasks)`);
console.log(`  2. Brainstorm          — ${BRAIN_SESSION_ID} (${BRAIN_BLOCKS.length} blocks, ${BRAIN_INSIGHTS.length} insights, ${BRAIN_TASKS.length} tasks)`);
console.log(`  3. Study Session       — ${STUDY_SESSION_ID} (${STUDY_BLOCKS.length} blocks, ${STUDY_INSIGHTS.length} insights, ${STUDY_TASKS.length} tasks)`);
console.log(`  4. Team Meeting        — ${MEETING_SESSION_ID} (${MEETING_BLOCKS.length} blocks, ${MEETING_INSIGHTS.length} insights, ${MEETING_TASKS.length} tasks)`);
