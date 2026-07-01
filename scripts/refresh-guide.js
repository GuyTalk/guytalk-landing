#!/usr/bin/env node
/**
 * Weekly guide refresh — asks OpenAI to update product prices, flag stale picks,
 * and suggest one new product per category. Writes a JSON patch file for each category.
 * The actual HTML files are updated from these patches.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Rotation tiers:
//   fast  — refresh every week (lots of product variety, trend-sensitive)
//   bi    — refresh every 2 weeks
//   slow  — refresh every 4 weeks (staples/classics, low churn)
// Week-of-year modulo determines whether slow/bi categories run this pass.
const ROTATION = { style: 'fast', watches: 'slow', 'bourbon-cigars': 'slow', cars: 'slow', fitness: 'fast', accessories: 'fast', golf: 'fast', other: 'bi' };

const CATEGORIES = [
  {
    id: 'style',
    name: 'Style',
    currentPicks: [
      'Peter Millar Crown Comfort Polo ~$95',
      'Buck Mason Curved Hem Tee ~$45',
      'A.P.C. Petit Standard Jeans ~$230',
      'Uniqlo Merino Crew ~$50',
      'Common Projects Achilles Low ~$450',
      'Todd Snyder Stretch Chino ~$148',
      'Taylor Stitch Chore Coat ~$278',
      'Oxford Button-Down Shirt (OCBD)',
      'Dior Sauvage EDT ~$90',
      'Le Labo Santal 33 ~$250',
    ],
  },
  {
    id: 'watches',
    name: 'Watches',
    currentPicks: [
      'Hamilton Khaki Field Mechanical ~$495',
      'Seiko 5 Sports ~$300',
      'Tissot PRX Powermatic 80 ~$650',
      'Tudor Black Bay ~$3,700',
      'Casio World Time ~$60',
      'Rolex Submariner (buy this instead: Tudor Black Bay)',
    ],
  },
  {
    id: 'bourbon-cigars',
    name: 'Bourbon & Cigars',
    currentPicks: [
      "Buffalo Trace ~$30",
      "Eagle Rare 10yr ~$40",
      "Blanton's Single Barrel ~$60",
      "Wild Turkey 101 ~$28",
      "Four Roses Single Barrel ~$55",
      "Oliva Serie V cigar ~$15",
      "Arturo Fuente Hemingway cigar ~$12",
    ],
  },
  {
    id: 'cars',
    name: 'Cars',
    currentPicks: [
      'BMW X5 (used, in-warranty) ~$45-65k',
      'Mercedes-AMG C43 (used) ~$40-55k',
      'Mazda MX-5 Miata',
      'Porsche 911 (used) ~$80-120k',
      'Lexus — stealth luxury play',
      'NOCO Boost Plus Jump Starter ~$100',
      'WeatherTech Floor Mats ~$150',
      'Leather Honey Conditioner ~$25',
      'VIOFO Dash Cam ~$130',
    ],
  },
  {
    id: 'fitness',
    name: 'Fitness',
    currentPicks: [
      'Bowflex SelectTech 552 Dumbbells ~$429',
      'Creatine Monohydrate ~$25',
      'Gold Standard Whey Protein ~$40',
      'REP Fitness Kettlebell 35lb ~$60',
      'Iron Gym Doorframe Pull-Up Bar ~$30',
      'Crossrope Jump Rope Set ~$60',
      'TriggerPoint Foam Roller ~$35',
      'Theragun Prime ~$249',
      'Nike Metcon 9 ~$130',
      'New Balance Fresh Foam 1080 ~$165',
      'WHOOP 4.0',
      'Hydro Flask 32oz ~$55',
      'Under Armour Duffel ~$45',
    ],
  },
  {
    id: 'accessories',
    name: 'Accessories',
    currentPicks: [
      'Bellroy Slim Sleeve Wallet ~$69',
      'Ridge Wallet ~$95',
      'Filson Small Duffel ~$350',
      'Bellroy Dopp Kit ~$89',
      'Persol 714 Folding Sunglasses ~$350',
      'Ray-Ban Wayfarer Classic ~$160',
      'Warby Parker Sunglasses ~$95',
      'Allen Edmonds Full-Grain Belt ~$95',
    ],
  },
  {
    id: 'golf',
    name: 'Golf',
    currentPicks: [
      'Titleist Pro V1 Golf Balls ~$55/dz',
      'Bushnell Pro X3 Rangefinder ~$400',
      'Vessel Player IV Stand Bag ~$350',
      'Callaway Paradym Ai Smoke Driver ~$500',
      'Odyssey White Hot OG #7 Putter ~$200',
      'FootJoy Traditions Golf Shoe ~$130',
      'Travis Mathew Oxford Polo ~$75',
      'Vice Pro Golf Balls ~$35/dz',
      'Garmin Approach S62 GPS Watch ~$350',
    ],
  },
  {
    id: 'other',
    name: 'Other',
    currentPicks: [
      'Anker MagSafe 3-in-1 Travel Charger ~$40',
      'Nomatic 40L Travel Pack ~$300',
      'Beardbrand Tree Ranger Utility Bar ~$15',
      'YETI Rambler 20oz Tumbler ~$38',
      'Apple AirTag 4-Pack ~$100',
      'Solo Stove Bonfire 2.0 ~$350',
    ],
  },
];

const SYSTEM_PROMPT = `You are a product editor at a men's lifestyle publication.
Your job is to review a category's current picks and provide:
1. Any significant price updates for the current picks (if you know they've changed significantly)
2. One new product recommendation that would fit well in this category
3. If any pick seems outdated or replaced by something clearly better, flag it

Be honest and direct. Keep the tone like GuyTalk: confident, opinionated, no filler.
Format your response as JSON only. No markdown, no code blocks.`;

async function refreshCategory(cat) {
  console.log(`Refreshing: ${cat.name}`);

  const userMsg = `Category: ${cat.name}
Current picks:
${cat.currentPicks.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Today's date: ${new Date().toISOString().split('T')[0]}

Return JSON with this exact structure:
{
  "category": "${cat.id}",
  "priceUpdates": [{"pick": "product name", "newPrice": "$X", "note": "optional context"}],
  "newPick": {
    "brand": "Brand Name",
    "name": "Product Name",
    "price": "~$X",
    "description": "2-3 sentence description in GuyTalk voice — direct, no fluff",
    "tag": "Buy This First | GuyTalk Pick | Best Value | Best Budget",
    "buyLink": "https://amazon.com/s?k=product+search+term&tag=guytalk-20"
  },
  "stalePicks": ["pick name if it should be replaced"]
}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const raw = res.choices[0].message.content.trim();
    const json = JSON.parse(raw);
    return json;
  } catch (err) {
    console.warn(`  Failed for ${cat.name}: ${err.message}`);
    return null;
  }
}

async function main() {
  const patchDir = path.join(__dirname, '..', 'guide', 'data');
  if (!fs.existsSync(patchDir)) fs.mkdirSync(patchDir, { recursive: true });

  // Determine which categories run this week based on rotation tier.
  // week-of-year (1-indexed) used as the modulo key.
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekOfYear = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  const forcedId = process.env.GUIDE_CATEGORY; // allow --env GUIDE_CATEGORY=golf to force a single category

  const activeCategories = CATEGORIES.filter(cat => {
    if (forcedId) return cat.id === forcedId;
    const tier = ROTATION[cat.id] || 'fast';
    if (tier === 'fast') return true;
    if (tier === 'bi') return weekOfYear % 2 === 0;
    if (tier === 'slow') return weekOfYear % 4 === 0;
    return true;
  });

  console.log(`Week ${weekOfYear} — refreshing ${activeCategories.length}/${CATEGORIES.length} categories: ${activeCategories.map(c => c.name).join(', ')}`);

  const results = [];
  for (const cat of activeCategories) {
    const patch = await refreshCategory(cat);
    if (patch) {
      results.push(patch);
      const file = path.join(patchDir, `${cat.id}-patch.json`);
      fs.writeFileSync(file, JSON.stringify(patch, null, 2));
      console.log(`  Saved: ${file}`);
      if (patch.newPick) {
        console.log(`  New pick: ${patch.newPick.brand} ${patch.newPick.name} ${patch.newPick.price}`);
      }
    }
    // Rate-limit friendly pause
    await new Promise(r => setTimeout(r, 1200));
  }

  const summaryFile = path.join(patchDir, `refresh-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({ date: new Date().toISOString(), patches: results }, null, 2));
  console.log(`\nDone. ${results.length}/${CATEGORIES.length} categories refreshed.`);
  console.log(`Summary: ${summaryFile}`);
}

main().catch(err => { console.error(err); process.exit(1); });
