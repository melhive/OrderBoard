# Ask Agent and Talk mode

Ask Agent is the assistant inside Order Board. Type or say what you want, and it takes the order, settles the bill or answers the question. It runs **fully on the phone**: rule-based language understanding, no AI service and no account. Typing works with no internet at all. Voice uses the phone's speech recognition; see [Voice](#voice).

Open it with the **Ask Agent** button. From a table's order screen it already knows which table you mean.

## Orders

| Say | What happens |
|---|---|
| `2 pares with egg and rice for table 3` | Adds them to Table 3 right away |
| `2 pares for table 1 and 3 siomai for table 2` | Several tables in one sentence |
| `and a water` / `same for table 4` | Follow-ups remember the last table for 3 minutes |
| `takeout 2 siomai and a coke` | Custom tables work by name |
| `2 pares walang sibuyas and 1 mami for table 1` | Kitchen notes go with the item |
| `extra sabaw sa mami table 1` | A note on an item already on the bill |
| `remove 1 siomai from table 1` / `cancel pares` | Removes items; with no table it finds the table that has it |
| `make it 3` / `change siomai to pastil on table 2` | Fix quantities or swap items |
| `no, table 4` / `mami pala` / `i meant softdrinks` | Corrects the last order |
| `move table 2 to table 4` / `transfer table 1 to 3` | Moves a bill (asks Yes first) |
| `served na table 1` / `sino hindi pa na-serve?` | Served marks and who's still waiting |
| `ubos na ang pastil` / `pastil available na` | Sold out, and back again |

**Taglish:** `dalawang mami at isang pastil table 1`, `pa-order po ng 3 siomai sa table 4`.

**Bisaya (orders only, replies stay English/Taglish):** `isa ka pares with egg og duha ka mami`, `duha ka siomai ug usa ka coke para sa table 2`, `tulo ka mami nga naay itlog sa table 4`, `usa ka pares with egg ug kan-on table 1`, `napulo ka buok siomai table 2`, `dugangi og usa ka mami`, `usa pa ka pastil`.

If it isn't sure what you meant, it asks before adding anything. Unknown items can be added as custom items with a price.

## Paying

| Say | What happens |
|---|---|
| `table 3 paid 500` / `table 2 bayad na` | Pays right away and shows the change |
| `table 1 paid gcash` / `table 4 paid using gcash` | GCash or Maya |
| `change for 500 on table 1` / `sukli sa 100 table 1` | Works out the change without paying |
| `table 1 paid and table 2 paid` | Several tables at once (one Undo takes back all of it) |
| `table 2 utang ni Ben` / `utang table 2 Juan` | Puts the bill on a customer's tab |
| `Ben paid 50` / `nagbayad si ben lahat gcash` | Records an utang payment |
| `sino may utang?` / `magkano utang ni Ben` | Who owes what |

Payments happen without a Yes step. To take one back, say `undo` or `undo table 4`, which undoes only that table's last change, even a payment.

## Questions

`how much did we sell today?`, `magkano benta ngayon`, `how many pares did we sell today`, `what's on table 2?`, `magkano table 3`, `how much is pares with egg?`, `compare today and yesterday`, `average order today`, `what is our busiest hour`, `profit today`, `magkano gastos ngayon`, `any tips?`

## Running the app

| Say | What happens |
|---|---|
| `change the price of mami to 55` | Menu price (asks Yes first) |
| `add tapsilog to the menu for 95 under pares` / `add menu item kwek kwek 20` | New menu item |
| `add table Delivery` | New table |
| `gastos 50 sa yelo` | Records an expense |
| `set working hours from 5pm to 1am` | Business hours |
| `open summary` / `open table 3` / `switch to light mode` | Navigation and theme |
| `restore the last order` | Puts the last paid order back on its table (asks Yes first) |
| `paano mag-backup?` / `how do I add a table?` | How-to answers with a button that takes you there |
| `what can you do?` | The full list |

It also chats: `good evening`, `kumusta ka?`, `pagod na ako`, `salamat po`. It answers in your language, says things differently each time, and remembers your name if you tell it (`ako si …`).

**It will never delete or reset sales records.** `reset today's sales` is refused. That needs the code-confirmation in Summary, done by you.

## Talk mode

A hands-free conversation: in Ask, tap the **Talk mode** button (top right). A glowing orb listens, answers out loud and listens again, with captions of what you said and what it said. Say `yes` or `oo` to confirm. It sends by itself when you pause, keeps the screen on, and rests after 3 minutes of silence. Tap the orb to pause, resume, or interrupt it while it's talking. Everything said is kept in the chat history.

## Voice

- **Android app:** uses the phone's own speech recognition. It works offline if the phone has Google's offline speech pack for English (Philippines) or English (US). Replies are read aloud by the phone's voice, a Filipino voice for Taglish replies when the phone has one.
- **Web app:** uses Chrome's speech recognition, which needs internet. Typing always works offline.
- Spoken replies and hands-free mode can be turned off in Settings → Ask Agent.

## For developers

The engine (`src/agent/engine.ts`) is a pure function: `respond(input, world, ctx)` returns a reply and a plan, and never changes data itself. `executor.ts` applies the plan with an undo checkpoint. New phrases and mishearings go in `src/agent/text.ts` (`TOKEN_SYNONYMS`, `PHRASE_SYNONYMS`) or menu item nicknames, always with a test in `engine.test.ts`. See [AGENTS.md](../AGENTS.md) for the full design.
