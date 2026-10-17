/**
 * Learned Model study (#148): does a layer of weights fitted to finished Seasons on top of the Elo Model's Ratings
 * predict each Game better than the Elo Model? Writes a text report under data/local/learned-model-study/ so study
 * results never end up in the repo.
 *
 *   npm run study:learned
 *
 * This ticket (#153) covers rungs 1–2 of the ladder and the per-Game metrics. The later rungs and the Season Simulation
 * metrics are added to this script by their own tickets; the rules below are fixed for all of them before the first run.
 *
 * Folds: walk-forward, testing 2023/24, 2024/25 and 2025/26. Each fold trains on every earlier Season from 2021/22, and
 * the Elo chain is warmed from 2017/18 (the warm-up chain, scripts/warmUp.ts).
 *
 * Elo baseline: one shared Elo chain at the production values (K 10, Home Advantage 60, carry-over 1). It feeds both the
 * Rating-difference feature and the Elo Model baseline. Those values were tuned on the same test Seasons (ADR 0004), a
 * leak that favours both sides equally; the report says so.
 *
 * Tuning: the Prior-Games count, the back-to-back rule and the regularisation are tuned only on each fold's training
 * Seasons, by an inner time split that trains on the earlier training Seasons and validates on the last training Season
 * (per-Game Brier). Where the thin inner split can't separate the options, the simplest setting wins: an option is
 * separated from the best only if it is within one standard error of the best's paired per-Game difference, and among
 * the options that are not separated the one earliest in the grid's simplicity order is chosen (default features first,
 * no regularisation first).
 *
 * The ladder, fixed in advance. Each rung must beat the rung below it on pooled per-Game Brier *and* in at least 2 of 3
 * test Seasons:
 *   1. ordered logit on Rating difference only (the baseline);
 *   2. ordered logit on the agreed features (goal difference, back-to-back flags, learned intercept): the ladder's root;
 *   3. + non-proportional OT/SO (partial proportional odds on a closeness term);
 *   4. the richer-input swaps and additions, nested in this order: regulation goal difference (an OT/SO Game counts as
 *      0); goal difference over periods 1–2; + shot-share difference, SOG for / (for + against); + special-teams net
 *      difference, PP goals for − PP goals against per Game;
 *   5. nonlinear learners (small MLP, then GBM) on the best linear feature set, each required to beat the best linear
 *      rung.
 * The highest rung reached is the Learned Model. Rung 1 is always reached. Selecting a rung makes its test score somewhat
 * optimistic, and the report says so.
 *
 * Reported, not gating: per-Game Brier, log loss, four-outcome RPS and OT/SO calibration by closeness third. Every Δ
 * against Elo gets a paired cluster bootstrap 95% interval (scripts/studyStats.ts), clustered by Match Day for per-Game
 * metrics (and by Season × team for Rank metrics, once those are added).
 *
 * Picker rule: the Learned Model joins the picker if it meets the inference caps (Projection History build adds at most
 * the Elo Model's ~3 s, weights ≤ ~50 KB, one prediction per Remaining Game per projection). Its score against Elo
 * doesn't matter here.
 *
 * Default rule (ADR 0004's rule): against the Elo Model, the Learned Model must be better on pooled per-Game Brier and
 * in at least 2 of 3 test Seasons, better on pooled Rank RPS and in at least 2 of 3 test Seasons, and have early-Season
 * Outer Tenths ≤ 25% at the Strength Uncertainty τ tuned on training Seasons. A failed guard means no Default, never a
 * retune. Significance isn't required.
 */
