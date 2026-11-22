/**
 * Villager dialogue pools. Stage 0 = early days (curious / worried), 1 = middle days (frightened),
 * 2 = final days (evacuating / despairing), 3 = after Zorg's defeat (joy).
 */
export type Role = "villager" | "farmer" | "merchant" | "smith" | "guard" | "innkeeper" | "healer" | "elder" | "child" | "traveller" | "mystic" | "historian";

export const GREETINGS = ["Bon dia!", "Hola, traveller.", "Bona tarda!", "Good to see you.", "Bon vespre.", "Ei, hero!"];

export const LINES: Record<Role, string[][]> = {
  villager: [
    ["Have you seen the strange cloud on the horizon? It glows purple at night.", "My grandmother says the old guardians will protect us. I hope she's right.", "The sheep refused to graze the high pastures this morning. Animals know things.", "Some say Zorg has returned to Comapedrosa. Just a story to scare children... isn't it?"],
    ["The cloud swallowed the southern valleys. My cousin in Sant Julià hasn't written.", "I can't sleep. Every morning the purple wall is closer.", "We're packing what we can carry. Where will we go? Andorra is all we know.", "Please, if you're going out there... be careful. The monsters are bolder now."],
    ["It's over, isn't it? Tell me it isn't over.", "Everyone is heading to Ordino. The old waystone there still keeps the air clean.", "I left everything behind. My house, my garden... all gone into the green fog.", "If you have the shards, hero, now is the time. There is no more tomorrow to wait for."],
    ["The sky is blue again! I'd forgotten how blue it could be.", "They say you struck down Zorg himself! Andorra will sing of you for a thousand years.", "We're going home. Thank you. Thank you!"],
  ],
  farmer: [
    ["The barley's coming in well this year. If only that cloud would stay put.", "Morning dew tasted bitter today. Never happened before.", "My cows are restless. They keep staring south."],
    ["I've harvested early. No point leaving crops for the poison.", "The fields near the river turned grey overnight. Grey!", "Can't plough land that kills you to stand on."],
    ["The farm is lost. I'll plant again someday, if there's a someday.", "Take this advice: never trust a green fog."],
    ["I'm going back to the fields tomorrow. The soil is already healing!"],
  ],
  merchant: [
    ["Potions, provisions, the finest goods in the valleys! Have a look.", "Business is good — everyone's buying Purity Tonics since that cloud appeared."],
    ["I'm closing shop early these days. Can't sell anything to a ghost town.", "Prices are what they are, friend. Fear is expensive."],
    ["I've moved what stock I could to Ordino. Buy now, there's no later."],
    ["Discount for the hero of Andorra! Well... a small one."],
  ],
  smith: [
    ["The forge is hot and my hammer is ready. Bring ore and I'll make your blade sing.", "There's an old legend of a smith who could forge light itself. He vanished into the mountains long ago."],
    ["I'm making spears for the guard day and night. We'll need every one.", "If you find Ancient Ore in the ruins, bring it to me."],
    ["My forge will be the last fire to go out in this village, I swear it."],
    ["I'll forge you a statue, hero. Well, maybe a very nice horseshoe."],
  ],
  guard: [
    ["Stay on the roads, traveller. Goblins have been spotted near the passes.", "The Captain doubled the watch. Something is stirring in the mountains.", "I swore to protect these valleys. I didn't think it would be against the sky itself."],
    ["We're building barricades at the village gates. Monsters grow bolder as the cloud spreads.", "Half the watch has gone to escort families. The rest of us hold the line.", "If you're going toward the cloud, drink a Purity Tonic first."],
    ["We'll hold the square as long as the waystone shines. After that... I don't know.", "Go, hero. Save us. We'll keep the lights burning."],
    ["The watch salutes you! Andorra stands because of you."],
  ],
  innkeeper: [
    ["Welcome to the inn! A warm bed and hot escudella — the best in the valleys.", "Travellers bring rumours: they say the old guardians hid five shards across Andorra."],
    ["Fewer guests every day. Those who come all tell the same story: the cloud is coming.", "Rest while you can, friend. The night is long."],
    ["I've opened the rooms to anyone fleeing. No charge. Not anymore."],
    ["Drinks are on the house tonight! For everyone!"],
  ],
  healer: [
    ["I brew potions from mountain herbs. Bring me some and I'll share my remedies.", "The cloud's poison burns the lungs. A Purity Tonic will protect you for a while."],
    ["I've treated six people for cloud-sickness today. Six!", "Take tonics with you. Many of them."],
    ["My herbs are all gone. All I can offer now is prayer."],
    ["The sick are recovering already. The air itself is healing."],
  ],
  elder: [
    ["Long ago, five guardians hid five shards across our mountains. Fire, Nature, Ice, Light and Lightning.", "Only a blade forged from all five can end the darkness of Zorg."],
    ["The cloud spreads faster than I feared. You must hurry, child.", "Find the legendary sword maker once you hold all five shards. He hides where smoke rises above the clouds."],
    ["I am old. I have seen hard winters. I have never seen a winter like this.", "Go now. Every hour matters."],
    ["The prophecy is fulfilled. I can rest now."],
  ],
  child: [
    ["Are you a real hero? Do you have a real sword?", "My big sister says purple clouds are made of grape juice. I don't believe her.", "I saw a deer with glowing eyes in the forest!"],
    ["Mama says we might have to leave. Will you come with us?", "I'm not scared. Okay, a little scared."],
    ["Can heroes beat clouds? Please beat the cloud."],
    ["You did it! You did it! I KNEW you could!"],
  ],
  traveller: [
    ["I came over the eastern pass. The fog there is thick as wool.", "On the road I heard the Thunder Titan woke on the Pessons summit."],
    ["The roads are empty. Everyone who could flee has fled.", "The Frost Dragon's cave is high on l'Estanyó. Bring warm clothes. And courage."],
    ["I'm staying. Nowhere else to go."],
    ["I'll tell this story in every land I pass through."],
  ],
  mystic: [
    ["The spirits are uneasy. Their lanterns flicker across the valleys...", "Look for strange glowing stones. They guard what the ancients left behind."],
    ["The veil between worlds thins as the darkness grows."],
    ["The lanterns are fading. Hurry, child of the valleys."],
    ["The spirits dance tonight. Can you hear them?"],
  ],
  historian: [
    ["The ancient steles across Andorra tell the history of the shards. Few can read them anymore.", "The Old Kings hid their treasures beneath the ruins near Lake Engolasters."],
    ["I'm trying to save the archives before the cloud reaches the capital."],
    ["History will remember these days... if anyone survives to write it."],
    ["I shall write the true chronicle of these days. You'll be on every page."],
  ],
};

export const FIRST_NAMES_M = ["Jordi", "Pere", "Joan", "Xavier", "Pau", "Arnau", "Quim", "Ferran", "Oriol", "Marc", "Jaume", "Albert", "Sergi", "Martí", "Biel", "Roger", "Enric", "Toni"];
export const FIRST_NAMES_F = ["Marta", "Núria", "Montse", "Laia", "Mireia", "Carme", "Roser", "Anna", "Teresa", "Gemma", "Mercè", "Aina", "Clara", "Júlia", "Neus", "Berta", "Eulàlia", "Rosa"];
