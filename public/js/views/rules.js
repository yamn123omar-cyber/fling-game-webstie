import { html, $ } from '../lib.js';
import { get } from '../api.js';
import { icon } from '../icons.js';
import { currentUrl } from '../router.js';

const pctOf = x => `${Math.round(x * 100)}%`;

export default {
    title: 'How it works',
    load: () => get('/config'),
    render(c) {
        const r = c.rating, p = c.points, d = c.tournamentDefaults;
        const toc = [['start', 'Getting started'], ['matchday', 'Match day'], ['solo', 'Solo format'], ['duo', 'Duo format'], ['solo-teams', 'Teams of 1'], ['scoring', 'Elo & points'], ['ranks', 'Ranks'], ['bracket', 'The bracket'], ['refs', 'Admins'], ['fairplay', 'Fair play'], ['faq', 'FAQ']];
        return html`<div class="wrap page rules">
            <div class="page-head"><div><span class="eyebrow">Rulebook</span><h1>How it works</h1>
                <p>Everything about tournaments, match rooms, scoring and what happens when someone doesn't show up.</p></div></div>
            <div class="rules-layout">
                <nav class="rules-toc">${toc.map(([id, l]) => html`<a href="#${id}">${l}</a>`)}</nav>
                <article class="rules-body">
                    <section id="start"><h2>${icon('userPlus')}Getting started</h2>
                        <ol class="nice">
                            <li><b>Create an account</b> and <a class="accent" href="/settings?tab=roblox">verify your Roblox account</a>. Admins and opponents need your in-game name, and it gives you your avatar.</li>
                            <li><b>Add friends</b> and <a class="accent" href="/teams">make a team</a> if you want to play duo. A team is two players; you can be on a few.</li>
                            <li><b>Register</b> for a tournament. Solo tournaments take you alone. Duo tournaments take a team — or you alone as a <a class="accent" href="#solo-teams">team of 1</a>.</li>
                            <li><b>Check in</b> when check-in opens (usually ${d.checkinMinutes} minutes before the start). Anyone not checked in when the bracket starts loses their spot.</li>
                        </ol>
                    </section>

                    <section id="matchday"><h2>${icon('clock')}Match day</h2>
                        <p>When your opponent is decided, your <b>match room</b> opens: a page with the scoreboard, both rosters (with Roblox names) and a chat. You get a notification.</p>
                        <div class="callouts">
                            <div>${icon('check')}<b>Check in</b><span>Match check-in opens ${d.matchCheckinMinutes} minutes before the scheduled time. Press "Check in — I'm here".</span></div>
                            <div>${icon('chat')}<b>Talk in the match room</b><span>Share your server, agree who hosts. The chat can't be edited or deleted and every message has a server timestamp.</span></div>
                            <div>${icon('flag')}<b>No-shows forfeit</b><span>${d.noShowGraceMinutes} minutes after the scheduled time, anyone not checked in forfeits automatically — no arguing, the log shows who was there.</span></div>
                            <div>${icon('calendar')}<b>Need another time?</b><span>Propose a new time in the match room. It only changes if the other side accepts. Admins can also reschedule.</span></div>
                        </div>
                        <p class="dim">Why the chat has to be on the site: if a player says "I was there, they never answered", the match room shows exactly when each side checked in and what they said. That's what the admins look at.</p>
                    </section>

                    <section id="solo"><h2>${icon('user')}Solo format (1v1)</h2>
                        <p>Both players join the same server. A match is a series of <b>duels</b>; each duel is <b>first to ${d.firstTo} kills</b> (admins can change this). Win <b>${Math.ceil(d.bestOf / 2)} of ${d.bestOf}</b> duels to win the match — finals are usually longer (best of ${d.finalBestOf}).</p>
                        <p>A duel can't end in a tie: keep fighting until someone gets the next kill.</p>
                    </section>

                    <section id="duo"><h2>${icon('users')}Duo format (2v2)</h2>
                        <p>A real 2v2 in FTAP gets messy and is impossible to score fairly, so a duo match is played as <b>two 1v1 duels</b>:</p>
                        <div class="duo-diagram big">
                            <div class="dd-team"><span class="pl a">A1</span><span class="pl a">A2</span></div>
                            <div class="dd-lines"><span><b>Duel 1</b></span><span><b>Duel 2</b></span></div>
                            <div class="dd-team"><span class="pl b">B1</span><span class="pl b">B2</span></div>
                        </div>
                        <ul class="ticks">
                            <li>Lineups are locked by rating: each team's <b>higher-rated player is #1</b>. Best vs best, second vs second — no counter-picking.</li>
                            <li>Win both duels → you win the match.</li>
                            <li><b>1–1?</b> The system randomly picks <b>two players who haven't fought each other yet</b> (so A1 vs B2 or A2 vs B1). That decider duel wins the match. ${d.drawRule === 'kills' ? '' : 'Admins can also choose to settle 1–1 on total kills first.'}</li>
                            <li>If one teammate doesn't check in, the other can still play <b>short-handed</b> and fights both duels. The missing player gets the no-show penalty.</li>
                        </ul>
                    </section>

                    <section id="solo-teams"><h2>${icon('user')}Teams of 1 in duo tournaments</h2>
                        <p>No partner? You can still enter a duo tournament alone (if the tournament allows it). You fight <b>both</b> duels yourself, and a decider would be a rematch against one of them. Because one strong player can carry a solo entry more easily than a full team, solo entries have handicaps so that teaming up is always the better deal:</p>
                        <table class="table rules-table">
                            <thead><tr><th></th><th>Full team (2)</th><th>Team of 1</th></tr></thead>
                            <tbody>
                                <tr><td>Elo on a win</td><td>100%</td><td>${pctOf(r.soloTeamWinMult)}</td></tr>
                                <tr><td>Elo on a loss</td><td>100%</td><td>${pctOf(r.soloTeamLossMult)}</td></tr>
                                <tr><td>Ranking points on a win</td><td>100%</td><td>${pctOf(p.soloTeamWinMult)}</td></tr>
                                <tr><td>Ranking points on a loss</td><td><b>0</b> (never lose RP)</td><td>${p.soloTeamLoss} RP</td></tr>
                                <tr><td>Placement points</td><td>100%</td><td>${pctOf(p.soloTeamWinMult)}</td></tr>
                            </tbody>
                        </table>
                    </section>

                    <section id="scoring"><h2>${icon('chart')}Elo & ranking points</h2>
                        <p>You have separate ratings for <b>Solo</b> and <b>Duo</b>. Everyone starts at <b>${r.start}</b>.</p>
                        <div class="callouts two">
                            <div>${icon('target')}<b>Elo = skill</b><span>Goes up when you win and down when you lose. Beating stronger opponents is worth more. The first ${r.provisionalMatches} matches move faster (K=${r.kProvisional}), then K=${r.k}, and K=${r.kHigh} above ${r.kHighThreshold}. In duo, your team's rating is the average of both players.</span></div>
                            <div>${icon('trophy')}<b>RP = progress</b><span>Win a match: ${p.matchWin} RP, scaled ${pctOf(p.strengthMin)}–${pctOf(p.strengthMax)} by how strong your opponent was. Losing costs nothing (except teams of 1). Placements add more: 1st ${p.placement[1]}, 2nd ${p.placement[2]}, 3rd ${p.placement[3]}, top 4 ${p.placement[4]}, top 8 ${p.placement[8]} — scaled by bracket size — plus ${p.participation} RP for finishing a tournament.</span></div>
                        </div>
                        <p>Forfeit wins give <b>+${p.forfeitWin} RP</b> and no Elo (you didn't have to play). A no-show costs <b>${r.noShowPenalty} Elo and ${-p.noShow} RP</b> and shows on your profile.</p>
                    </section>

                    <section id="ranks"><h2>${icon('medal')}Ranks</h2>
                        <div class="tier-ladder">${c.tiers.map(t => html`<div class="tier-step" style="--c:${t.color}"><i></i><b>${t.name}</b><span class="mono">${t.min ? `${t.min}+` : `< ${c.tiers[1].min}`}</span></div>`)}</div>
                    </section>

                    <section id="bracket"><h2>${icon('bracket')}The bracket</h2>
                        <p>Every tournament uses a <b>two-sided bracket</b>. Players are split into a <b>left</b> and a <b>right</b> side (seeded by rating, so the two best players can only meet in the Final). Each side plays down to one winner, and the two side winners meet <b>in the middle</b> for the Final.</p>
                        <ul class="nice">
                            <li><b>Losers bracket:</b> when a round has an odd number of players, nobody gets a free pass. Instead, everyone who lost in that round fights in a small losers bracket, and the winner takes the open spot — so losing once doesn't always mean you're out.</li>
                            <li><b>3rd place:</b> the two players who lose the side finals play for 3rd place.</li>
                            <li>The <a class="accent" href="/bracket">Bracket</a> page shows everything live — zoom, fullscreen, and save it as an image.</li>
                        </ul>
                    </section>

                    <section id="refs"><h2>${icon('shield')}Admins</h2>
                        <p>FTAP has no built-in 1v1 scoreboard, so every match is scored by an <b>admin</b>. The owner picks trusted players and makes them admins.</p>
                        <ul class="nice">
                            <li>An admin takes your match, joins your server and watches every duel.</li>
                            <li>Players can't enter scores. Admins can't score a match they're playing in.</li>
                            <li>Admins who run a tournament <b>can't sign up for it</b> — so nobody can cheat their own bracket.</li>
                            <li>Admins can rule forfeits, reschedule, fix mistakes and reopen a result if something went wrong.</li>
                        </ul>
                    </section>

                    <section id="fairplay"><h2>${icon('shield')}Fair play</h2>
                        <ul class="ticks">
                            <li>Be on time. Check in, and use the match room to communicate.</li>
                            <li>No exploits, scripts or teaming with outsiders. Admins can disqualify.</li>
                            <li>Only kills during a duel count; the admin's call is final.</li>
                            <li>Be decent in chat. Everything in match rooms is kept.</li>
                        </ul>
                    </section>

                    <section id="faq"><h2>${icon('info')}FAQ</h2>
                        <details><summary>My opponent says they were there but I never saw them.</summary><p>Look at the match room: check-ins are logged with the exact time. If they didn't check in before the deadline, they forfeited. If both checked in, sort out the server in chat and call an admin.</p></details>
                        <details><summary>Something happened with my internet mid-duel.</summary><p>Tell the admin in the match room. They decide whether to replay the duel. If you can't come back, the admin can rule a forfeit.</p></details>
                        <details><summary>How are seeds decided?</summary><p>By Elo (Solo or Duo, depending on the tournament) at the moment the bracket starts. Top seeds get byes if the bracket isn't full.</p></details>
                        <details><summary>I played on the old site. Is my account gone?</summary><p>No — log in with your old username and password and your account moves over automatically.</p></details>
                        <details><summary>How do I become an admin?</summary><p>Ask the owner. Admins are picked in the Owner panel.</p></details>
                    </section>
                </article>
            </div>
        </div>`;
    },
    mount(root) {
        const hash = currentUrl().hash || location.hash;
        if (hash) {
            const el = $(hash, root);
            if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 50);
        }
    },
};
