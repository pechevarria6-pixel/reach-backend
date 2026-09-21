# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reach.spec.ts >> 7. Performance >> No console errors on home page load
- Location: tests/reach.spec.ts:253:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "Access to fetch at 'https://nominatim.openstreetmap.org/reverse?lat=35.17&lon=-79.39&format=json' from origin 'https://www.alcanzar.io' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
+   "Failed to load resource: net::ERR_FAILED",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - alert [ref=e2]
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: Reach
      - generic [ref=e9]:
        - button "Switch to the light theme" [ref=e10] [cursor=pointer]
        - button "Sign out" [ref=e14] [cursor=pointer]
    - generic [ref=e18]:
      - generic [ref=e20]:
        - generic [ref=e21]:
          - generic [ref=e22]: Good morning, Peter
          - generic [ref=e23]: Who's overdue for a good night out?
          - generic [ref=e24]: The best plans start with one person saying when.
        - generic [ref=e25]:
          - generic [ref=e26]: Waiting on you
          - button "Moab, Utah, USA is ready to book Everyone's in — let's see what we can get booked Book →" [ref=e29] [cursor=pointer]:
            - generic [ref=e30]:
              - generic [ref=e31]: Moab, Utah, USA is ready to book
              - generic [ref=e32]: Everyone's in — let's see what we can get booked
            - button "Book →" [ref=e33]
        - generic [ref=e34]:
          - generic [ref=e35]: Upcoming trips
          - generic [ref=e36] [cursor=pointer]: See all →
        - generic [ref=e37]:
          - button "👍 Ready to book Moab, Utah, USA Sep 17 – 30 · Alone & Afraid PE" [ref=e38] [cursor=pointer]:
            - generic [ref=e39]:
              - generic [ref=e40]: 👍 Ready to book
              - generic [ref=e41]: Moab, Utah, USA
              - generic [ref=e42]: Sep 17 – 30 · Alone & Afraid
              - generic [ref=e43]: PE
          - button "📋 Planning The Milk Carton Kids Sep 21 · Alone & Afraid Today PE" [ref=e45] [cursor=pointer]:
            - generic [ref=e46]:
              - generic [ref=e47]: 📋 Planning
              - generic [ref=e48]: The Milk Carton Kids
              - generic [ref=e49]: Sep 21 · Alone & Afraid
              - generic [ref=e50]: Today
              - generic [ref=e51]: PE
          - button "📋 Planning Downtown Raleigh Italian Evening Sep 25 · 30th bday In 4 days PE" [ref=e53] [cursor=pointer]:
            - generic [ref=e54]:
              - generic [ref=e55]: 📋 Planning
              - generic [ref=e56]: Downtown Raleigh Italian Evening
              - generic [ref=e57]: Sep 25 · 30th bday
              - generic [ref=e58]: In 4 days
              - generic [ref=e59]: PE
          - button "📋 Planning Greek Dinner & Jazz at The Pit Sep 26 · Lets go In 5 days PE" [ref=e61] [cursor=pointer]:
            - generic [ref=e62]:
              - generic [ref=e63]: 📋 Planning
              - generic [ref=e64]: Greek Dinner & Jazz at The Pit
              - generic [ref=e65]: Sep 26 · Lets go
              - generic [ref=e66]: In 5 days
              - generic [ref=e67]: PE
          - button "✓ Booked E2E test weekend — Raleigh Oct 9 – 11 · Alone & Afraid In 3 weeks PE" [ref=e69] [cursor=pointer]:
            - generic [ref=e70]:
              - generic [ref=e71]: ✓ Booked
              - generic [ref=e72]: E2E test weekend — Raleigh
              - generic [ref=e73]: Oct 9 – 11 · Alone & Afraid
              - generic [ref=e74]: In 3 weeks
              - generic [ref=e75]: PE
          - button "📋 Planning E2E test weekend — Raleigh Oct 9 – 11 · Alone & Afraid In 3 weeks PE" [ref=e77] [cursor=pointer]:
            - generic [ref=e78]:
              - generic [ref=e79]: 📋 Planning
              - generic [ref=e80]: E2E test weekend — Raleigh
              - generic [ref=e81]: Oct 9 – 11 · Alone & Afraid
              - generic [ref=e82]: In 3 weeks
              - generic [ref=e83]: PE
          - button "📋 Planning E2E test weekend — Raleigh Oct 9 – 11 · Alone & Afraid In 3 weeks PE" [ref=e85] [cursor=pointer]:
            - generic [ref=e86]:
              - generic [ref=e87]: 📋 Planning
              - generic [ref=e88]: E2E test weekend — Raleigh
              - generic [ref=e89]: Oct 9 – 11 · Alone & Afraid
              - generic [ref=e90]: In 3 weeks
              - generic [ref=e91]: PE
          - button "📋 Planning E2E test weekend — Raleigh Oct 9 – 11 · Alone & Afraid In 3 weeks PE" [ref=e93] [cursor=pointer]:
            - generic [ref=e94]:
              - generic [ref=e95]: 📋 Planning
              - generic [ref=e96]: E2E test weekend — Raleigh
              - generic [ref=e97]: Oct 9 – 11 · Alone & Afraid
              - generic [ref=e98]: In 3 weeks
              - generic [ref=e99]: PE
          - button "📋 Planning E2E test weekend — Aberdeen Oct 9 – 11 · Alone & Afraid In 3 weeks PE" [ref=e101] [cursor=pointer]:
            - generic [ref=e102]:
              - generic [ref=e103]: 📋 Planning
              - generic [ref=e104]: E2E test weekend — Aberdeen
              - generic [ref=e105]: Oct 9 – 11 · Alone & Afraid
              - generic [ref=e106]: In 3 weeks
              - generic [ref=e107]: PE
          - button "📋 Planning E2E test weekend — Aberdeen Oct 9 – 11 · Alone & Afraid In 3 weeks PE" [ref=e109] [cursor=pointer]:
            - generic [ref=e110]:
              - generic [ref=e111]: 📋 Planning
              - generic [ref=e112]: E2E test weekend — Aberdeen
              - generic [ref=e113]: Oct 9 – 11 · Alone & Afraid
              - generic [ref=e114]: In 3 weeks
              - generic [ref=e115]: PE
          - button "📋 Planning Puerto Vallarta, Mexico Nov 2 – 9 · Alone & Afraid In a month PE" [ref=e117] [cursor=pointer]:
            - generic [ref=e118]:
              - generic [ref=e119]: 📋 Planning
              - generic [ref=e120]: Puerto Vallarta, Mexico
              - generic [ref=e121]: Nov 2 – 9 · Alone & Afraid
              - generic [ref=e122]: In a month
              - generic [ref=e123]: PE
          - button "＋ New plan" [ref=e125] [cursor=pointer]:
            - generic [ref=e126]: ＋
            - generic [ref=e127]: New plan
        - generic [ref=e128]: Jump back in
        - button "✈️ Alone & Afraid · 9 plans Open →" [ref=e129] [cursor=pointer]:
          - generic [ref=e130]: ✈️
          - generic [ref=e131]:
            - generic [ref=e132]: Alone & Afraid · 9 plans
            - generic [ref=e133]: Open →
        - button "🧭 12 trips on the go. See all →" [ref=e134] [cursor=pointer]:
          - generic [ref=e135]: 🧭
          - generic [ref=e136]:
            - generic [ref=e137]: 12 trips on the go.
            - generic [ref=e138]: See all →
        - generic [ref=e139]: Near you
        - generic [ref=e141] [cursor=pointer]:
          - generic [ref=e142]: 🌮
          - generic [ref=e143]:
            - generic [ref=e144]: Habanero’s Taqueria
            - generic [ref=e145]: restaurant · West Morganton Road
          - generic [ref=e146]: 1 mi
        - generic [ref=e148] [cursor=pointer]:
          - generic [ref=e149]: 🎸
          - generic [ref=e150]:
            - generic [ref=e151]: The Roosters Wife
            - generic [ref=e152]: Music Venues · Performing Arts · Aberdeen
          - generic [ref=e153]:
            - generic [ref=e154]: Pricey
            - generic [ref=e155]: 3 mi
        - generic [ref=e156] [cursor=pointer]:
          - generic [ref=e157]: 🍣
          - generic [ref=e158]:
            - generic [ref=e159]: Maguro Hibachi Steakhouse
            - generic [ref=e160]: restaurant · Brucewood Road
          - generic [ref=e161]: 2 mi
        - generic [ref=e163] [cursor=pointer]:
          - generic [ref=e164]: 💃
          - generic [ref=e165]:
            - generic [ref=e166]: Elite Academy of Dance
            - generic [ref=e167]: dancing school · Turner Street
          - generic [ref=e168]: 2 mi
        - generic [ref=e170] [cursor=pointer]:
          - generic [ref=e171]: 🍝
          - generic [ref=e172]:
            - generic [ref=e173]: Olive Garden
            - generic [ref=e174]: restaurant · US 15/501
          - generic [ref=e175]: 2 mi
        - generic [ref=e177] [cursor=pointer]:
          - generic [ref=e178]: 🏺
          - generic [ref=e179]:
            - generic [ref=e180]: Raven Pottery
            - generic [ref=e181]: Arts & Crafts · Art Galleries · Southern Pines
          - generic [ref=e182]: 1 mi
        - generic [ref=e184] [cursor=pointer]:
          - generic [ref=e185]: 🏺
          - generic [ref=e186]:
            - generic [ref=e187]: 9th of September Pottery Painting
            - generic [ref=e188]: pottery · Midland Road
          - generic [ref=e189]: 3 mi
        - generic [ref=e191] [cursor=pointer]:
          - generic [ref=e192]: 💃
          - generic [ref=e193]:
            - generic [ref=e194]: OM Grown Dance Studios
            - generic [ref=e195]: dancing school · Knight Street
          - generic [ref=e196]: 3 mi
        - generic [ref=e198] [cursor=pointer]:
          - generic [ref=e199]: 🍝
          - generic [ref=e200]:
            - generic [ref=e201]: Lisi Market
            - generic [ref=e202]: restaurant · Cherokee Road
          - generic [ref=e203]: 5 mi
        - generic [ref=e205] [cursor=pointer]:
          - generic [ref=e206]: 🍺
          - generic [ref=e207]:
            - generic [ref=e208]: Pinehurst Brewing Company
            - generic [ref=e209]: brewery · Magnolia Road
          - generic [ref=e210]: 5 mi
        - generic [ref=e212] [cursor=pointer]:
          - generic [ref=e213]: 🌮
          - generic [ref=e214]:
            - generic [ref=e215]: Casa Santa Ana
            - generic [ref=e216]: restaurant · Central Park Avenue
          - generic [ref=e217]: 6 mi
        - generic [ref=e219] [cursor=pointer]:
          - generic [ref=e220]: 🍝
          - generic [ref=e221]:
            - generic [ref=e222]: Valenti's Italian Restaurant
            - generic [ref=e223]: restaurant · US 1 BUS
          - generic [ref=e224]: 8 mi
        - generic [ref=e226] [cursor=pointer]:
          - generic [ref=e227]: 🏺
          - generic [ref=e228]:
            - generic [ref=e229]: Linda Dalton Pottery
            - generic [ref=e230]: pottery · Oakhurst Vista
          - generic [ref=e231]: 9 mi
        - generic [ref=e233] [cursor=pointer]:
          - generic [ref=e234]: 🌮
          - generic [ref=e235]:
            - generic [ref=e236]: Emma's Kitchen
            - generic [ref=e237]: restaurant · US 1 BUS
          - generic [ref=e238]: 8 mi
        - generic [ref=e240] [cursor=pointer]:
          - generic [ref=e241]: 🏛️
          - generic [ref=e242]:
            - generic [ref=e243]: Union Station Railroad Museum
            - generic [ref=e244]: museum · East Main Street
          - generic [ref=e245]: 3 mi
        - generic [ref=e247] [cursor=pointer]:
          - generic [ref=e248]: 🎸
          - generic [ref=e249]:
            - generic [ref=e250]: Anstead's Tobacco Company
            - generic [ref=e251]: Tobacco Shops · Lounges · Fayetteville
          - generic [ref=e252]:
            - generic [ref=e253]: Moderate
            - generic [ref=e254]: 26 mi
        - generic [ref=e255] [cursor=pointer]:
          - generic [ref=e256]: 🎸
          - generic [ref=e257]:
            - generic [ref=e258]: Sweet Tea Shakespeare
            - generic [ref=e259]: Performing Arts · Fayetteville
          - generic [ref=e260]: 29 mi
        - generic [ref=e262] [cursor=pointer]:
          - generic [ref=e263]: 🏺
          - generic [ref=e264]:
            - generic [ref=e265]: Muse
            - generic [ref=e266]: Bubble Tea · Art Classes · Fayetteville
          - generic [ref=e267]: 30 mi
        - generic [ref=e269] [cursor=pointer]:
          - generic [ref=e270]: 🎵
          - generic [ref=e271]:
            - generic [ref=e272]: "J. Cole: The Fall-Off Tour"
            - generic [ref=e273]: Wed, Sep 23 · Crown Coliseum
          - generic [ref=e274]: 30 mi
        - generic [ref=e276] [cursor=pointer]:
          - generic [ref=e277]: 🎸
          - generic [ref=e278]:
            - generic [ref=e279]: FireClay Cellars
            - generic [ref=e280]: Wineries · Siler City
          - generic [ref=e281]:
            - generic [ref=e282]: Moderate
            - generic [ref=e283]: 40 mi
        - generic [ref=e284] [cursor=pointer]:
          - generic [ref=e285]: 🍳
          - generic [ref=e286]:
            - generic [ref=e287]: Flour Power
            - generic [ref=e288]: Cooking Classes · Day Camps · Holly Springs
          - generic [ref=e289]: 46 mi
        - generic [ref=e291] [cursor=pointer]:
          - generic [ref=e292]: 🏺
          - generic [ref=e293]:
            - generic [ref=e294]: Piedmont Pottery
            - generic [ref=e295]: Art Classes · Art Galleries · Fuquay-Varina
          - generic [ref=e296]: 44 mi
        - generic [ref=e298] [cursor=pointer]:
          - generic [ref=e299]: 🏆
          - generic [ref=e300]:
            - generic [ref=e301]: Carolina Hurricanes vs Florida Panthers (Preseason)
            - generic [ref=e302]: Tue, Sep 22 · Lenovo Center
          - generic [ref=e303]: 58 mi
        - generic [ref=e305] [cursor=pointer]:
          - generic [ref=e306]: 🎵
          - generic [ref=e307]:
            - generic [ref=e308]: Margaret Glaspy w/ Anna Tivel
            - generic [ref=e309]: Tue, Sep 22 · Cat's Cradle
          - generic [ref=e310]: 54 mi
        - generic [ref=e312] [cursor=pointer]:
          - generic [ref=e313]: 🎵
          - generic [ref=e314]:
            - generic [ref=e315]: Shaboozey - Outlaws Never Die Tour
            - generic [ref=e316]: Tue, Sep 22 · Red Hat Amphitheater
          - generic [ref=e317]: 59 mi
        - generic [ref=e319] [cursor=pointer]:
          - generic [ref=e320]: 🎵
          - generic [ref=e321]:
            - generic [ref=e322]: GoldFord - Space of the Heart Tour
            - generic [ref=e323]: Tue, Sep 22 · The Ritz
          - generic [ref=e324]: 62 mi
        - generic [ref=e326] [cursor=pointer]:
          - generic [ref=e327]: 🎉
          - generic [ref=e328]:
            - generic [ref=e329]: Prelude Dining- Maybe Happy Ending
            - generic [ref=e330]: Tue, Sep 22 · Steven Tanger Center for the Performing Arts
          - generic [ref=e331]: 66 mi
        - generic [ref=e333] [cursor=pointer]:
          - generic [ref=e334]: 🎭
          - generic [ref=e335]:
            - generic [ref=e336]: Buena Vista Social Club (Touring)
            - generic [ref=e337]: Tue, Sep 22 · DPAC
          - generic [ref=e338]: 63 mi
        - generic [ref=e340] [cursor=pointer]:
          - generic [ref=e341]: 🎭
          - generic [ref=e342]:
            - generic [ref=e343]: Maybe Happy Ending (Touring)
            - generic [ref=e344]: Tue, Sep 22 · Steven Tanger Center for the Performing Arts
          - generic [ref=e345]: 66 mi
        - generic [ref=e347] [cursor=pointer]:
          - generic [ref=e348]: 🎵
          - generic [ref=e349]:
            - generic [ref=e350]: Taste Of Chaos
            - generic [ref=e351]: Wed, Sep 23 · The Ritz
          - generic [ref=e352]: 62 mi
        - generic [ref=e354] [cursor=pointer]:
          - generic [ref=e355]: 🎉
          - generic [ref=e356]:
            - generic [ref=e357]: Prelude Dining- Maybe Happy Ending
            - generic [ref=e358]: Wed, Sep 23 · Steven Tanger Center for the Performing Arts
          - generic [ref=e359]: 66 mi
        - generic [ref=e361] [cursor=pointer]:
          - generic [ref=e362]: 🎭
          - generic [ref=e363]:
            - generic [ref=e364]: Buena Vista Social Club (Touring)
            - generic [ref=e365]: Wed, Sep 23 · DPAC
          - generic [ref=e366]: 63 mi
        - generic [ref=e368] [cursor=pointer]:
          - generic [ref=e369]: 🎭
          - generic [ref=e370]:
            - generic [ref=e371]: Maybe Happy Ending (Touring)
            - generic [ref=e372]: Wed, Sep 23 · Steven Tanger Center for the Performing Arts
          - generic [ref=e373]: 66 mi
        - generic [ref=e375] [cursor=pointer]:
          - generic [ref=e376]: 🎵
          - generic [ref=e377]:
            - generic [ref=e378]: French Police
            - generic [ref=e379]: Mon, Sep 21 · Neighborhood Theatre Tap Room
          - generic [ref=e380]: 80 mi
        - generic [ref=e382] [cursor=pointer]:
          - generic [ref=e383]: 🎵
          - generic [ref=e384]:
            - generic [ref=e385]: Cyril Neville Plays The Dead
            - generic [ref=e386]: Tue, Sep 22 · Neighborhood Theatre Main Room
          - generic [ref=e387]: 80 mi
        - generic [ref=e389] [cursor=pointer]:
          - generic [ref=e390]: 🎵
          - generic [ref=e391]:
            - generic [ref=e392]: "Yeat: The LOVE/LYFE Tour"
            - generic [ref=e393]: Mon, Sep 21 · Skyla Credit Union Amphitheatre
          - generic [ref=e394]: 82 mi
        - generic [ref=e396] [cursor=pointer]:
          - generic [ref=e397]: 🎵
          - generic [ref=e398]:
            - generic [ref=e399]: TASTE OF CHAOS
            - generic [ref=e400]: Tue, Sep 22 · The Fillmore Charlotte
          - generic [ref=e401]: 82 mi
        - generic [ref=e403] [cursor=pointer]:
          - generic [ref=e404]: 🎉
          - generic [ref=e405]:
            - generic [ref=e406]: 2026 Taste of the Panthers
            - generic [ref=e407]: Tue, Sep 22 · Bank of America Stadium
          - generic [ref=e408]: 83 mi
        - generic [ref=e410] [cursor=pointer]:
          - generic [ref=e411]: 🎵
          - generic [ref=e412]:
            - generic [ref=e413]: Curtis Salgado
            - generic [ref=e414]: Wed, Sep 23 · Middle C Jazz
          - generic [ref=e415]: 82 mi
        - generic [ref=e417] [cursor=pointer]:
          - generic [ref=e418]: 🎵
          - generic [ref=e419]:
            - generic [ref=e420]: gnash
            - generic [ref=e421]: Tue, Sep 22 · The Underground
          - generic [ref=e422]: 82 mi
        - generic [ref=e424] [cursor=pointer]:
          - generic [ref=e425]: 🎵
          - generic [ref=e426]:
            - generic [ref=e427]: Gorillaz - The Mountain Tour
            - generic [ref=e428]: Wed, Sep 23 · Spectrum Center
          - generic [ref=e429]: 82 mi
      - navigation [ref=e432]:
        - button "Home" [ref=e433] [cursor=pointer]
        - button "Discover" [ref=e439] [cursor=pointer]
        - button "Groups" [ref=e445] [cursor=pointer]
        - button "Profile" [ref=e452] [cursor=pointer]
```

# Test source

```ts
  171 |     // so this should be a clean 401 (307 kept for safety).
  172 |     const res = await request.get(`${BASE_URL}/api/me`);
  173 |     expect([200, 401, 307]).toContain(res.status());
  174 |   });
  175 | 
  176 |   test('/api/groups returns valid JSON', async ({ request }) => {
  177 |     const res = await request.get(`${BASE_URL}/api/groups`);
  178 |     expect([200, 401, 307]).toContain(res.status());
  179 |   });
  180 | 
  181 |   test('/api/nearby returns events', async ({ request }) => {
  182 |     const res = await request.get(`${BASE_URL}/api/nearby`);
  183 |     expect(res.status()).toBeLessThan(500);
  184 |     if (res.status() === 200) {
  185 |       const data = await res.json();
  186 |       expect(data).toHaveProperty('events');
  187 |       expect(Array.isArray(data.events)).toBeTruthy();
  188 |     }
  189 |   });
  190 | 
  191 |   test('/api/recommendations accepts POST', async ({ request }) => {
  192 |     const res = await request.post(`${BASE_URL}/api/recommendations`, {
  193 |       data: { vibe: 'chill', budget: 2000, nights: 5, travelers: 2 }
  194 |     });
  195 |     expect(res.status()).toBeLessThan(500);
  196 |   });
  197 | 
  198 |   test('Webhook endpoints exist', async ({ request }) => {
  199 |     const stripe = await request.post(`${BASE_URL}/api/webhooks/stripe`, { data: {} });
  200 |     expect(stripe.status()).toBeLessThan(500);
  201 |     const clerk = await request.post(`${BASE_URL}/api/webhooks/clerk`, { data: {} });
  202 |     expect(clerk.status()).toBeLessThan(500);
  203 |   });
  204 | });
  205 | 
  206 | test.describe('6. Trip quiz flow', () => {
  207 |   test.beforeEach(async ({ page }) => {
  208 |     await signIn(page);
  209 |     await waitForApp(page);
  210 |   });
  211 | 
  212 |   test('Can navigate to group trip planner', async ({ page }) => {
  213 |     await page.waitForSelector('.nb-btn', { timeout: 15000 });
  214 |     const tabs = await page.locator('.nb-btn').all();
  215 |     if (tabs[2]) await tabs[2].click();
  216 |     await page.waitForTimeout(1000);
  217 | 
  218 |     // The account under test always has groups; if it does not, this test is
  219 |     // not exercising navigation and should say so rather than pass quietly.
  220 |     const cards = page.locator('.card');
  221 |     await expect(cards.first()).toBeVisible({ timeout: 15000 });
  222 |     {
  223 |       await cards.first().click();
  224 |       await page.waitForTimeout(1000);
  225 |       // A group opens on its plans: the trips it already has, each with a way
  226 |       // in, and a way to start another. "Plan a Trip" was the old label.
  227 |       const plans = await page.locator('text=/Plans|Coming up/i').first()
  228 |         .isVisible({ timeout: 8000 }).catch(() => false);
  229 |       const intoAPlan = await page.locator('text=/View|New/i').first()
  230 |         .isVisible({ timeout: 8000 }).catch(() => false);
  231 |       expect(plans || intoAPlan).toBeTruthy();
  232 |     }
  233 |   });
  234 | });
  235 | 
  236 | test.describe('7. Performance', () => {
  237 |   test('Home page loads in under 10 seconds', async ({ page }) => {
  238 |     const start = Date.now();
  239 |     await page.goto(`${BASE_URL}/home`);
  240 |     await page.waitForLoadState('domcontentloaded');
  241 |     const elapsed = Date.now() - start;
  242 |     expect(elapsed).toBeLessThan(10000);
  243 |   });
  244 | 
  245 |   test('Sign in page loads in under 5 seconds', async ({ page }) => {
  246 |     const start = Date.now();
  247 |     await page.goto(`${BASE_URL}/sign-in`);
  248 |     await page.waitForLoadState('domcontentloaded');
  249 |     const elapsed = Date.now() - start;
  250 |     expect(elapsed).toBeLessThan(5000);
  251 |   });
  252 | 
  253 |   test('No console errors on home page load', async ({ page }) => {
  254 |     const errors: string[] = [];
  255 |     page.on('response', r => { if (r.status() === 404) errors.push('404: ' + r.url()); });
  256 |     page.on('console', msg => {
  257 |       if (msg.type() === 'error') errors.push(msg.text());
  258 |     });
  259 |     await page.goto(`${BASE_URL}/sign-in`);
  260 |     await page.waitForLoadState('networkidle');
  261 |     // Filter out known non-critical errors
  262 |     const critical = errors.filter(e =>
  263 |       !e.includes('icon-192') &&
  264 |       !e.includes('favicon') &&
  265 |       !e.includes('manifest') &&
  266 |       !e.includes('development keys') &&
  267 |       !e.includes('afterSignInUrl') &&
  268 |       !e.includes('themeColor') &&
  269 |       !e.includes('viewport')
  270 |     );
> 271 |     expect(critical).toEqual([]);
      |                      ^ Error: expect(received).toEqual(expected) // deep equality
  272 |   });
  273 | });
  274 | 
  275 | test.describe('8. Mobile viewport', () => {
  276 |   test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14
  277 | 
  278 |   test('App renders correctly on iPhone viewport', async ({ page }) => {
  279 |     await page.goto(`${BASE_URL}/sign-in`);
  280 |     await page.waitForLoadState('domcontentloaded');
  281 |     // Check nothing is overflowing
  282 |     const overflow = await page.evaluate(() => {
  283 |       return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  284 |     });
  285 |     expect(overflow).toBeFalsy();
  286 |   });
  287 | 
  288 |   test('Phone frame is visible on desktop', async ({ page }) => {
  289 |     await page.setViewportSize({ width: 1440, height: 900 });
  290 |     await page.goto(`${BASE_URL}/home`);
  291 |     await page.waitForLoadState('domcontentloaded');
  292 |     await expect(page.locator('.aw').first()).toBeVisible({ timeout: 20000 });
  293 |   });
  294 | });
  295 | 
  296 | // ─────────────────────────────────────────────────────────────────────────
  297 | // 9. Legal pages — listed as public in middleware, and for a long time they
  298 | //    404'd, which is the kind of gap nobody notices until someone looks.
  299 | test.describe('9. Legal pages', () => {
  300 |   test.use({ storageState: { cookies: [], origins: [] } });
  301 | 
  302 |   for (const [path, heading] of [['/privacy', 'Privacy'], ['/terms', 'Terms']]) {
  303 |     test(`${path} is public and has real content`, async ({ page }) => {
  304 |       const res = await page.goto(`${BASE_URL}${path}`);
  305 |       expect(res?.status()).toBe(200);
  306 |       await expect(page.locator('h1')).toContainText(heading);
  307 |       // A stub page would pass a status check; this asserts substance.
  308 |       const words = (await page.locator('main').innerText()).split(/\s+/).length;
  309 |       expect(words).toBeGreaterThan(300);
  310 |     });
  311 |   }
  312 | 
  313 |   test('Terms state plainly that Reach never holds funds', async ({ page }) => {
  314 |     await page.goto(`${BASE_URL}/terms`);
  315 |     // The product principle the whole payment design rests on. If this
  316 |     // sentence ever disappears, the page has drifted from the product.
  317 |     await expect(page.locator('main')).toContainText(/never hold/i);
  318 |   });
  319 | });
  320 | 
  321 | // ─────────────────────────────────────────────────────────────────────────
  322 | // 10. API authorisation boundaries. RLS is not the security model here — the
  323 | //     routes are — so an unauthenticated call must be refused, not empty.
  324 | test.describe('10. Profile API', () => {
  325 |   test.use({ storageState: { cookies: [], origins: [] } });
  326 | 
  327 |   for (const path of ['/api/profile', '/api/profile/loyalty']) {
  328 |     test(`${path} refuses an unauthenticated caller`, async ({ request }) => {
  329 |       const res = await request.get(`${BASE_URL}${path}`);
  330 |       expect([401, 405]).toContain(res.status());
  331 |     });
  332 |   }
  333 | 
  334 |   test('Profile never returns a full document number', async ({ request }) => {
  335 |     // Even unauthenticated, assert the shape contract: the route is built to
  336 |     // send last4 only, never the decrypted value.
  337 |     const res = await request.get(`${BASE_URL}/api/profile`);
  338 |     const body = await res.text();
  339 |     expect(body).not.toMatch(/passport_number_enc|tsa_precheck_enc|global_entry_enc/);
  340 |   });
  341 | });
  342 | 
  343 | // ─────────────────────────────────────────────────────────────────────────
  344 | // 11. Stripe publishable key is served at runtime, because Vercel hides
  345 | //     Sensitive variables from the build and NEXT_PUBLIC_ would compile in
  346 | //     as undefined.
  347 | test.describe('11. Stripe config', () => {
  348 |   test.use({ storageState: { cookies: [], origins: [] } });
  349 | 
  350 |   test('/api/config/stripe serves a publishable key, never a secret', async ({ request }) => {
  351 |     const res = await request.get(`${BASE_URL}/api/config/stripe`);
  352 |     expect(res.status()).toBe(200);
  353 |     const body = await res.json();
  354 |     expect(body.publishableKey).toMatch(/^pk_(test|live)_/);
  355 |     // The one thing this endpoint must never do.
  356 |     expect(JSON.stringify(body)).not.toMatch(/sk_(test|live)_/);
  357 |   });
  358 | });
  359 | 
  360 | // ─────────────────────────────────────────────────────────────────────────
  361 | // 12. Theme. Light is the default, and a stored choice is applied before
  362 | //     first paint so dark users never see a light frame flash past.
  363 | test.describe('12. Theme', () => {
  364 |   test.use({ storageState: { cookies: [], origins: [] } });
  365 | 
  366 |   test('Defaults to light with no stored preference', async ({ page }) => {
  367 |     await page.goto(`${BASE_URL}/sign-in`);
  368 |     const stamped = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  369 |     expect(stamped).toBeNull();
  370 |   });
  371 | 
```