# Prior art: learned game-outcome models for hockey on small data

Research for [#139](https://github.com/andyscanzio/nl-predict/issues/139) (child of wayfinder map [#137](https://github.com/andyscanzio/nl-predict/issues/137)). Researched 2026-10-16.

**Question.** Which learned models (logistic/ordinal regression, small MLPs, gradient boosting, learned-rating hybrids) have beaten Elo-style ratings at predicting ice hockey (or similar low-scoring sports) Game outcomes, and with how much data? What features and targets do they use? How are they calibrated? What does the evidence say about neural networks trained on about 1,800 Games? The setting is the National League: 14 teams, 364 Games per Season, about 5 past Seasons of score-only data. Our Default Model is an Elo Model (K=10, Home Advantage 60, σ=50) that outputs four-way Outcome Probabilities.

## Short answer

- **No primary source shows a neural network or gradient-boosting model beating a well-tuned rating model on score-only hockey data at this scale.** The hockey ML literature is small. It is NHL-only, reports accuracy rather than log loss or calibration, and its credible results sit at 57–61 % accuracy. That is roughly where a home-advantage-plus-rating model already sits, and inside the noise of a few hundred test Games.
- **The approaches that do win in comparative studies are rating-based.** One kind keeps the rating as the main input and learns a thin, calibrated link on top: an ordered logit on the Elo difference. The other is a goal model with time decay (independent or bivariate Poisson, Dixon–Coles style). In football, where most of the careful comparisons exist, these match or beat raw Elo. Machine-learning models win the open challenge only when they are fed *rating features*, not raw statistics.
- **Hockey's draw problem is our OT/SO problem.** Goal models need extra mass on tied scores (diagonal inflation). A Bradley–Terry variant exists that learns separate regulation and OT/SO outcome levels for hockey's 3-2-1-0 points.
- **Calibration, not accuracy, is the right selection criterion.** Use log loss or Ranked Probability Score on a rolling, out-of-time holdout. With 364 Games per Season, an accuracy difference of a few points is not significant.

## Hockey-specific evidence

### Hockey is among the most random team sports

Lopez, Matthews and Baumer (2018) fit Bayesian state-space models to a decade of betting-market data across the NFL, NBA, MLB and NHL. They find that the NHL and MLB "stand out for their relative randomness in game outcomes". The NBA has the largest spread in talent. ([arXiv:1701.05976](https://arxiv.org/abs/1701.05976); *Annals of Applied Statistics* 12(4), 2018, [Project Euclid](https://projecteuclid.org/euclid.aoas/1542078053))

*Implication:* the ceiling on discrimination is low, so most of a model's value comes from calibration.

### NHL machine-learning studies (accuracy only)

| Study | Data | Models | Features | Best result |
|---|---|---|---|---|
| Weissbock, Viktor & Inkpen 2013 ([PDF](https://www.eecs.uottawa.ca/~diana/publications/ECML_PKDD___2013.pdf)) | 517 NHL Games (2012/13 lockout season), binary win/loss | WEKA NN, Naive Bayes, SVM (SMO), C4.5 | 11 team stats; top three after feature selection: home/away, Goals Against, Goal Differential | NN 59.38 % in 10-fold CV, after tuning "by inspection"; untuned SVM 58.61 %; holdout NN 57.83 % |
| Weissbock & Inkpen 2014 ([CanAI PDF](https://www.eecs.uottawa.ca/~diana/publications/josh_CanAI2014_84360251.pdf)) | 708 NHL Games | 10 WEKA classifiers plus a cascading ensemble | Same three statistical features plus pre-game-report text and sentiment | 60.3 % (ensemble); per the Bunker & Susnjak review, Table 3 |
| Weissbock 2014 MSc thesis ([uOttawa](https://ruor.uottawa.ca/handle/10393/31553)) | NHL | — | — | Argues there is a theoretical single-game accuracy ceiling of about 62 %, driven by parity and luck |
| Gu et al. 2019 (per [Bunker & Susnjak review](https://arxiv.org/abs/1912.11762), Table 3) | NHL 2007/08–2016/17 | kNN, SVM, NB, trees, boosting/bagging ensembles | 19+ features, including player-level and PCA ranks | Claims 91.8 % accuracy. This is far above the ~62 % ceiling and almost certainly reflects leakage or in-sample evaluation. It is not credible evidence. |
| Geryk 2026, BSc thesis, Prague UEB ([record](https://vskp.vse.cz/english/100665_prediction-of-nhl-game-outcomes-using-machine-learning-methods)) | NHL 2019/20–2024/25, about 6 seasons, test on an unseen season | Logistic regression, Random Forest, XGBoost, neural network | 35 selected predictors, **including Elo ratings** | Logistic regression best (60.60 %). It was the "most robust"; the NN did not beat it. |

Takeaways:
- On 517 Games, the gap between NN (59.4 %, tuned on the CV folds) and SVM (58.6 %) is under one point. The binomial standard error at n≈500 is about 2.2 points, so these classifiers are indistinguishable. Weissbock's own feature selection kept essentially **home/away and goal-based form**, which is what a rating already encodes.
- The most recent and most comparable study (six NHL seasons, rating features included, out-of-time test) found **logistic regression on Elo plus features beat XGBoost, Random Forest and a neural network**.
- None of these studies reports log loss, Brier score or calibration, or compares against a pure Elo baseline on the same holdout. The Bunker & Susnjak (2019) review notes that hockey studies all used a binary target.

### Hockey four-way / OT-SO targets

- **Bivariate Poisson with tie inflation, Czech Extraliga.** Marek, Šedivá & Ťoupal, "Modeling and prediction of ice hockey match results", *JQAS* 10(3), 2014, pp. 357–365 ([ASA summary](https://magazine.amstat.org/?p=35296)). They model scores as bivariate Poisson "that acknowledge increased probabilities of ties", applied to a European league that is structurally like ours. Full text not accessible here, so their predictive numbers are unverified.
- **Bradley–Terry with multiple outcomes for hockey.** Whelan & Klein, [arXiv:2112.01267](https://arxiv.org/abs/2112.01267). This generalises Bradley–Terry so that regulation, OT and shootout wins and losses get different weights, matching the 3-2-1-0 / one-third scoring used in European and international hockey. It is fitted by MAP or HMC. This is a learned-rating model whose output is natively four-way.
- **Overtime as a separate process.** NHL work models OT goals as exponential time-to-goal, with shootouts as censored observations (see the search summary of the 2008 *American Statistician* paper, [doi:10.1198/000313008X303928](https://informahealthcare.com/doi/abs/10.1198/000313008X303928)). This supports splitting P(tie after 60′) from P(win | OT/SO).

## Evidence from football (the best-studied low-scoring analogue)

- **Elo difference inside an ordered logit.** Hvattum & Arntzen, *IJF* 26(3), 2010, [doi:10.1016/j.ijforecast.2009.10.002](https://doi.org/10.1016/j.ijforecast.2009.10.002). Elo-derived covariates feed an ordered logit (home/draw/away) and are compared with six benchmarks. The Elo covariate was the most useful encoding of past results, but it was still less accurate than market odds (secondary summary). Arntzen & Hvattum 2021, [*Statistical Modelling* 21(5)](https://statmod.org/smij/Vol21/Iss5/Arntzen/Abstract.html), keep the Elo difference as a covariate in an OLR that "directly outputs probabilities for each of the three possible match outcomes".
- **Elo-OLR beats goal-based models for World Cups.** Robberechts & Davis (MLSA 2018 workshop, [record](https://lida.sport-iat.de/dfb/Record/4054852)) compared Elo vs goal-based ODM ratings inside ordered logit and bivariate Poisson models. Backtesting 2002–2014, "an ordered logit model with Elo ratings as a single covariate achieves the best performance".
- **Time-weighted Poisson is best among strength models.** Ley, Van de Wiele & Van Eetvelde, *Statistical Modelling* 19(1), 2019 ([arXiv:1705.09575](https://arxiv.org/abs/1705.09575)), compared 10 strength models (Thurstone–Mosteller, Bradley–Terry, independent Poisson, bivariate Poisson) fitted by weighted maximum likelihood with a time-depreciation weight. Ranked by RPS, the best were the **bivariate and independent Poisson** models.
- **ML wins only on rating features.** The 2017 Soccer Prediction Challenge (*Machine Learning* 108, 2019; Open International Soccer Database, 216,743 matches) is the relevant case. The winner, Hubáček, Šourek & Železný ([MLJ](https://mlanthology.org/mlj/2019/hubacek2019mlj-learning)), used **gradient-boosted trees on pi-ratings and PageRank-style rating features**. Berrar, Lopes & Dubitzky ([MLJ](https://mlanthology.org/mlj/2019/berrar2019mlj-incorporating)) found that k-NN or XGBoost on *learned rating features* was best. ML added value on top of ratings, using hundreds of thousands of matches. Even then, the feature that mattered was a rating.
- **Elo is hard to beat in another sport too (tennis).** Kovalchik, *JQAS* 12(3), 2016 ([record](https://vuir.vu.edu.au/34652/)), tested 11 published models on 2,395 ATP matches. The FiveThirtyEight Elo and ranking-based regression were most accurate; more complex point-based models were not.
- **Learned ratings via gradient descent.** Lasek & Gagolewski, *IJF* 37(3), 2021 ([record](https://dro.deakin.edu.au/articles/journal_contribution/Interpretable_sports_team_rating_models_based_on_the_gradient_descent_algorithm/20680726)), fit interpretable rating models, including a Skellam goal-difference variant, by gradient descent. They are relevant as "Elo with a learned loss", but the abstract could not be read here, so their head-to-head result vs Elo is unverified.

## Neural networks on about 1,800 Games

- No primary source found trains a neural network on a few thousand hockey Games and beats a rating baseline out-of-sample on a proper scoring rule. The hockey NN results are at n=517–708, accuracy-only, and within noise of simpler classifiers (Weissbock 2013/2014). In the one recent multi-season study with Elo features, the NN lost to logistic regression (Geryk 2026).
- General tabular-ML evidence points the same way. Grinsztajn, Oyallon & Varoquaux (NeurIPS 2022 Datasets track, [arXiv:2207.08815](https://arxiv.org/abs/2207.08815)) benchmarked 45 datasets and found tree-based models still beat deep learning on "medium-sized" tabular data (about 10K samples). Our data is about 5× smaller and has far less signal per row.
- **Practical sizing.** A four-way target with score-only inputs has few informative features: rating difference, home/away, perhaps rest and recent goal form. A logistic or ordinal model with 3–5 parameters can be estimated well from 1,800 Games; an MLP has no extra structure to find. On one test Season of 364 Games, accuracy has a standard error of about 2.6 points. A real gain from a fancier model would likely be a log-loss improvement of a few thousandths, detectable only by pooling several rolling-origin Seasons.

## Calibration practice

- **Select on calibration.** Walsh & Joshi, *Machine Learning with Applications* 16, 2024 ([record](https://researchportal.bath.ac.uk/en/publications/machine-learning-for-sports-betting-should-model-selection-be-bas/)), studied NBA models. Selecting models by calibration instead of accuracy gave ROI of +34.69 % vs −35.17 % on average.
- **Football practice uses RPS for ordered outcomes.** Ley et al. 2019 and the 2017 Challenge both do. Our four-way outcome (RW, OTW, OTL, RL) is ordered, so RPS and multiclass log loss are both natural. Accuracy throws away exactly what a Season Simulation consumes.
- **An ordered logit on the Elo difference is itself a calibration layer.** It replaces Elo's fixed 400-point logistic and hand-chosen OT split with fitted cutpoints. This is the cheapest "learned" model, and it is the form the football evidence favours.

## Recommendation for NL Predict

Test these against the current Elo Default Model, in this order, on rolling-origin out-of-Season holdouts. Score them by four-way log loss and RPS, plus a reliability plot. Report accuracy only as a secondary metric.

1. **Ordered (or multinomial) logit on the Elo difference plus home**, with four ordered outcomes RW > OTW > OTL > RL. This is a learned-rating hybrid. It learns the cutpoints, including the OT/SO band, from about 1,800 Games with 4–5 parameters. It is the strongest-evidenced candidate.
2. **Time-decayed Poisson goal model** (Dixon–Coles / Ley et al. style, independent or bivariate, with tie/diagonal inflation per Marek et al.). Map P(tie after 60′) to OT/SO and split it by a fitted or near-coin-flip OT/SO win probability. It uses the score margin, which Elo currently ignores.
3. **Whelan–Klein multi-outcome Bradley–Terry**, if a natively four-way paired-comparison model is wanted.
4. **Gradient boosting or a small MLP**: low priority. Only worth trying on rating features (Elo diff, Poisson strengths, rest days), never on raw stats. The prior expectation is no gain over (1). The evidence gives no reason to expect a neural network to beat Elo on 1,800 score-only Games.

## Caveats and gaps

- Several primary texts were not readable here: Marek et al. 2014, Lasek & Gagolewski 2021, Hvattum & Arntzen 2010 full text, and Weissbock 2014. Their claims above rest on abstracts, publisher or society summaries, or the Bunker & Susnjak review, as marked.
- The Geryk 2026 work is a bachelor's thesis, not peer-reviewed. It is cited because it is the only recent multi-season hockey comparison with Elo features.
- No study found evaluates a four-way regulation/OT/SO target with proper scoring rules in a European hockey league. Our own backtest will be the first real evidence.
