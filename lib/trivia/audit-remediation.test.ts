import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildAutoQuizPlan, getAutoBuildAvailability } from './auto-build'
import { buildSubmissionGrading, markPendingGradingIncorrect, scoreSubmission } from './grading'
import { buildConfidentRevealResults } from './reveal'
import { teamAdmissionTransition } from './team-admission'
import { formatNumericResponseInput, parseNumericResponseInput } from './numeric-response'
import { leaderboardVisibilityFromSettings } from './leaderboard-visibility'
import { restoreAutoRunClock } from './auto-run'

// Execute the real nested handlers with deterministic network/browser responses.
// This guards async control flow without replacing it with a test-only copy.
const sources = new Map<string, ts.SourceFile>()
function handler(file: string, name: string, globals: Record<string, unknown>) {
  let source = sources.get(file)
  if (!source) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    sources.set(file, source)
  }
  let code = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(source)
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) code = 'var ' + node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!code) throw new Error(`Missing handler: ${name}`)
  const context = vm.createContext({ console, ...globals })
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return context
}
const host = 'components/host/HostPrototype.tsx'
const player = 'components/player/PlayerPrototype.tsx'
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const channel = () => ({ on() { return this }, subscribe() { return this } })

describe('remaining cross-screen audit regressions', () => {
  it('B7 keeps a claimed share recoverable when its follow-up read fails', async () => {
    const dismissIncomingShare = vi.fn(), setIncomingShareError = vi.fn()
    const query = { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: { message: 'offline' } }) }
    const context = handler(host, 'claimIncomingShare', { incomingShareToken: 'token', claimingShareRef: { current: false }, setClaimingShare: vi.fn(), setIncomingShareError, dismissIncomingShare, supabase: { rpc: async () => ({ data: 'copied', error: null }), from: () => query } })
    await context.claimIncomingShare(); expect(dismissIncomingShare).not.toHaveBeenCalled()
    expect(setIncomingShareError).toHaveBeenLastCalledWith(expect.stringContaining('Your copy was saved'))
  })
  it('C6 preserves credentials when approval wins the withdrawal race', async () => {
    const removeItem = vi.fn(), go = vi.fn()
    const context = handler(player, 'changeTeamName', { localStorage: { getItem: () => 'token', removeItem }, withdrawingRef: { current: false }, setWithdrawing: vi.fn(), setStatusError: vi.fn(), go, supabase: { rpc: async () => ({ data: false, error: null }) } })
    await context.changeTeamName(); expect(removeItem).not.toHaveBeenCalled(); expect(go).not.toHaveBeenCalled()
  })
  it('F8 reports duplicate template names instead of overwriting', async () => {
    const insert = vi.fn(), setError = vi.fn(), setTemplates = vi.fn()
    const query = { insert, select() { return this }, single: async () => ({ data: null, error: { code: '23505' } }) }; insert.mockReturnValue(query)
    const context = handler(host, 'saveQuizAsTemplate', { window: { prompt: () => 'Existing' }, busyId: null, setBusyId: vi.fn(), setError, setTemplates, templateStructureFromSource: async () => ({}), supabase: { from: () => query } })
    await context.saveQuizAsTemplate({ id: 'q', title: 'Quiz' })
    expect(setTemplates).not.toHaveBeenCalled(); expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('already exists'))
  })
  it('B2 excludes in-show sources from backup replacements', async () => {
    const availableTiebreakerReplacements = vi.fn().mockReturnValue([])
    const context = handler(host, 'cycleLibraryTiebreaker', { replacingLibraryTiebreakerId: null, tiebreakers: [{ id: 'tb', sourceTiebreakerId: 'backup', tiebreakerKey: 'tb' }], rounds: [{ showGames: [{ sourceTiebreakerId: 'in-show' }] }], setReplacingLibraryTiebreakerId: vi.fn(), setTiebreakerReplacementError: vi.fn(), loadAllSourceRows: async () => ({ data: [], error: null }), availableTiebreakerReplacements, tiebreakerReplacementHistoryRef: { current: new Map() } })
    await context.cycleLibraryTiebreaker('tb')
    expect([...availableTiebreakerReplacements.mock.calls[0][2]]).toEqual(['backup', 'in-show'])
  })
})

// Structural wiring checks complement the executed-handler, SQL and browser
// tests. These are not substitutes for full user-flow coverage.
describe('cross-screen audit wiring guards', () => {
  const h = readFileSync(host, 'utf8'), p = readFileSync(player, 'utf8')
  const questions = readFileSync('components/host/QuestionsArea.tsx', 'utf8')
  it('F20 retains presence timestamps on scoring refreshes', () => {
    const live = h.slice(h.indexOf('function LiveQuestion('), h.indexOf('function FinalResults('))
    for (const line of live.split('\n').filter(line => line.includes(".select('id, name, score"))) expect(line).toContain('last_seen_at')
  })
  it('F21 keeps backup drafts keyed by attempt', () => { expect(p.includes('backup-${next.attempt_id}')).toBe(true); expect(p.includes('backup-${state.attempt_id}')).toBe(true) })
  it('F29 clamps pagination after deletion', () => { expect(questions).toContain('if (page > lastPage) { setPage(lastPage)') })
  it('F38 saves multipart labels in visible order', () => { expect(h).toContain('parts.map((part, index) => ({ label: String.fromCharCode(65 + index), clue: part.text.trim() }))') })
  it('A7/A8 key-bind and cancel absolute-deadline actions', () => { expect(h).toContain('autoRunPublishedKeyRef.current !== key'); expect(h).toContain('serverNow() >= deadline + AUTO_RUN_SUBMISSION_GRACE_MS'); expect(h).toContain('return () => window.clearInterval(timer)') })
  it('A9 supports focused host navigation buttons', () => { expect(h.includes('!mayAdvanceFromReviewControl && !mayNavigateFromNavigationControl')).toBe(true); expect(h.includes("event.key === 'ArrowLeft' || event.key === 'ArrowRight'")).toBe(true) })
  it('B3 ignores late preferences after interaction', () => { expect(h).toContain('preferencesEditedRef.current || Object.keys(settings).length === 0'); expect(h).toContain('onChangeCapture={() => { preferencesEditedRef.current = true }}') })
  it('B4 preserves generated tiebreaker provenance and answers', () => { expect(h.includes('source_tiebreaker_id: tiebreaker.id')).toBe(true); expect(h.includes('correctNumber: Number(tiebreaker.correct_value)')).toBe(true); expect(h.includes('tiebreaker_answer_unit: tiebreaker.answer_unit')).toBe(true) })
  it('B5 requires verified platform search results', () => { expect(readFileSync('components/host/BuilderQuestionPicker.tsx', 'utf8')).toContain('if (origin === "platform") query = query.eq("is_verified", true)') })
  it('B6 uses complete paginated replacement pools', () => { expect(h).toContain('loadAllSourceRows<AutoBuildSourceTiebreaker>'); expect(h).toContain(".order('id').range(from, to)") })
  it('D6 keeps round topics at the template shortcut', () => { expect(h).toContain("roundTopicMode: TemplateRoundTopicMode = 'keep'") })
  it('D7 recomputes generated quiz readiness', () => { expect(h).toContain('p_status: quizStatusFromReadiness(readiness)') })
  it('E4 includes media in the shared question card', () => { expect(p).toMatch(/question\?\.image_url/); expect(p).toContain('PlayerQuestionCard') })
  it('E7 previews choices and part clues', () => { expect(h).toContain("active.question.questionType === 'multiple-choice' ? option.label : option.clue") })
  it('E9 does not deadline-submit untouched rankers', () => { expect(p).toContain('useAutoSubmitPlayerDraft(items, hasDraft && items.length > 0') })
})

describe('audit remediation: async and content boundaries', () => {
  it('C1 routes manual takeover through grading when earlier answers remain unscored', async () => {
    const updateLiveGame = vi.fn()
    const go = vi.fn()
    const query = { select() { return this }, eq() { return this }, in() { return this }, is() { return this }, limit: async () => ({ data: [{ id: 'pending' }], error: null }) }
    const context = handler(host, 'checkpointBeforeLeavingRound', {
      liveGameId: 'g', allQuestions: [{ round_number: 1, question_key: 'q' }], autoRunMode: 'off',
      supabase: { from: () => query }, updateLiveGame, go,
    })
    expect(await context.checkpointBeforeLeavingRound(1)).toBe(true)
    expect(updateLiveGame).toHaveBeenCalledWith(expect.objectContaining({ status: 'live', current_screen: 'intermission', round_scores_finalized: false }))
    expect(go).toHaveBeenCalledWith('end-of-round')
    expect(await context.checkpointBeforeLeavingRound(2)).toBe(false)
  })

  it.each(['handleAdvanceShowGame', 'handleAdvanceContentScreen'])('F30 %s cannot finalize past the grading checkpoint', async name => {
    const finalizeLiveGame = vi.fn()
    const checkpointBeforeLeavingRound = vi.fn().mockResolvedValue(true)
    const context = handler(host, name, {
      showGame: { id: 'sg', round_number: 1, item_position: 2, status: 'exploded', settings: {} },
      contentScreen: { round_number: 1, item_position: 2 },
      liveGameId: 'g', actionBusyRef: { current: false }, setActionBusy: vi.fn(), setLiveError: vi.fn(),
      allQuestions: [], allContentScreens: [], allShowGames: [], liveSequenceItems: () => [],
      finalizeLiveGame, checkpointBeforeLeavingRound,
    })
    await context[name]()
    expect(checkpointBeforeLeavingRound).toHaveBeenCalledWith(1)
    expect(finalizeLiveGame).not.toHaveBeenCalled()
  })

  it('F31 starts a games-only next round instead of jumping to a later question', async () => {
    const updateLiveGame = vi.fn()
    const go = vi.fn()
    const context = handler(host, 'startNextRound', {
      roundDataReady: true, roundFinalized: true, busyRef: { current: false },
      nextRoundItem: { kind: 'show-game', roundNumber: 2, showGame: { show_game_key: 'round2-game' } },
      currentQuestion: { question_key: 'round1-q' }, setBusy: vi.fn(), setError: vi.fn(),
      submittedAnswersEditable: false, updateLiveGame, go,
    })
    await context.startNextRound()
    expect(updateLiveGame).toHaveBeenCalledWith(expect.objectContaining({ current_screen: 'show-game', current_show_game_key: 'round2-game', round_scores_finalized: false }))
    expect(go).toHaveBeenCalledWith('live-question')
  })

  it('A3/A8 restores a paused or elapsed clock without resetting the duration', () => {
    expect(restoreAutoRunClock({ auto_run_clock: { key: 'q', paused_remaining: 12 } }, 'q', 5000)).toEqual({ paused: true, deadline: null, remaining: 12 })
    expect(restoreAutoRunClock({ auto_run_clock: { key: 'q', deadline_ms: 45000 } }, 'q', 39000)?.remaining).toBe(6)
    expect(restoreAutoRunClock({ auto_run_clock: { key: 'q', deadline_ms: 45000 } }, 'q', 50000)?.remaining).toBe(0)
    expect(restoreAutoRunClock({ auto_run_clock: { key: 'old', deadline_ms: 45000 } }, 'q', 5000)).toBeNull()
  })

  it('F4 retries a failed deadline submission, and cancels retries on navigation', async () => {
    vi.useFakeTimers()
    try {
      const cleanups: (() => void)[] = []
      const submit = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(true)
      const context = handler(player, 'useAutoSubmitPlayerDraft', {
        Date, serverNow: () => Date.now(),
        usePlayerAutoRunClock: () => ({ key: 'open-q-core', deadlineMs: Date.now() + 1000, label: 'Answers close', paused: false }),
        useRef: (current: unknown) => ({ current }),
        useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
        window: { setTimeout, clearTimeout },
      })
      context.useAutoSubmitPlayerDraft('partial draft', true, submit, 'q', 'core')
      await vi.advanceTimersByTimeAsync(1000)
      expect(submit).toHaveBeenCalledTimes(2)
      expect(submit).toHaveBeenLastCalledWith('partial draft', { deadline: true })
      cleanups.forEach(cleanup => cleanup())
      submit.mockClear().mockResolvedValue(undefined)
      context.useAutoSubmitPlayerDraft('new draft', true, submit, 'q', 'core')
      await vi.advanceTimersByTimeAsync(750)
      cleanups.forEach(cleanup => cleanup())
      await vi.advanceTimersByTimeAsync(1000)
      expect(submit).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('F1 preserves unsaved edits made while saving and does not leave the editor', async () => {
    let complete!: (result: unknown) => void
    const editRevisionRef = { current: 1 }
    const setDirty = vi.fn()
    const context = handler(host, 'saveQuiz', {
      savingRef: { current: false }, loading: false, editRevisionRef,
      expectedQuizStatus: 'draft', title: 'A quiz', rounds: [], tiebreakers: [],
      quizId: null, estimatedMinutes: 0, readiness: { blockers: ['Add a question'] },
      setSaving: vi.fn(), setSaveError: vi.fn(), setSaveNotice: vi.fn(), setQuizId: vi.fn(),
      setPersisted: vi.fn(), setNewQuiz: vi.fn(), setQuizStatus: vi.fn(), setDirty,
      localStorage: { setItem: vi.fn(), removeItem: vi.fn() },
      supabase: { rpc: () => new Promise(resolve => { complete = resolve }) },
    })
    const result = context.saveQuiz()
    editRevisionRef.current += 1
    complete({ data: 'saved-quiz', error: null })
    expect(await result).toBeNull()
    expect(setDirty).toHaveBeenCalledWith(true)
  })

  it('F18/F19 retheming preserves custom questions and configured points', async () => {
    const custom = { id: 'custom', sourceOrigin: 'user', sourceQuestionId: 'u', questionType: 'single-answer', pointsMax: 5 }
    let rounds = [{ id: 1, title: 'Old', questions: [custom, { id: 'library', sourceOrigin: 'platform', sourceQuestionId: 'old', questionType: 'single-answer', pointsMax: 4 }] }]
    const context = handler(host, 'replaceRoundTopic', {
      rounds, roundTopicBusyId: null, editRevisionRef: { current: 0 },
      setRoundTopicBusyId: vi.fn(), setRoundTopicError: vi.fn(), setDirty: vi.fn(),
      setRounds: (update: (value: typeof rounds) => typeof rounds) => { rounds = update(rounds) },
      loadAllSourceRows: async () => ({ data: [{ id: 'new', question_type: 'single-answer', category: 'Music', category_names: ['Music'] }], error: null }),
      libraryReplacementFit: () => 0,
      sourceToBuilderQuestion: () => ({ id: 'replacement', sourceOrigin: 'platform', sourceQuestionId: 'new', questionType: 'single-answer', pointsMax: 1 }),
      crypto: { getRandomValues: () => [0] },
    })
    await context.replaceRoundTopic(1, 'Music')
    expect(rounds[0].questions[0]).toBe(custom)
    expect(rounds[0].questions[1]).toMatchObject({ id: 'library', pointsMax: 4, sourceQuestionId: 'new' })
  })

  it('D1 marks pending parts incorrect without discarding the already-correct parts', () => {
    const question = { question_type: 'multi-part', correct_answer: ['Canada', 'France'], points_max: 2, options: null }
    const grading = buildSubmissionGrading(question, '["Canada","Frannce"]')
    expect(grading.items.map(item => item.status)).toEqual(['correct', 'review'])
    const results = buildConfidentRevealResults(question, [{ id: 's', is_correct: null, answer_text: '["Canada","Frannce"]', grading_json: markPendingGradingIncorrect(grading) }])
    expect(results[0]).toMatchObject({ points_awarded: 1, is_correct: false })
    expect(grading.items[1].status).toBe('review')
  })

  it('C5 recovers a removed approved team instead of waiting forever', () => {
    expect(teamAdmissionTransition({ admission_status: 'approved', team_id: null, game_status: 'live', name: 'Removed team' })).toEqual({ kind: 'denied' })
  })

  it.each(['useSubmitAnswer', 'useSubmitBonusAnswer'])('F17 ignores a late response after %s unmounts', async name => {
    let finish!: (result: unknown) => void
    const cleanups: (() => void)[] = []
    const go = vi.fn()
    const context = handler(player, name, {
      playerAdmissionArgs: () => ({ p_request_id: 'request', p_request_token: 'token' }),
      useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, vi.fn()],
      useEffect: (effect: () => (() => void)) => { cleanups.push(effect()) },
      localStorage: { getItem: (key: string) => key.includes('team') ? 'team' : 'game', setItem: vi.fn() },
      supabase: { rpc: () => new Promise(resolve => { finish = resolve }) },
      window: { clearTimeout: vi.fn(), setTimeout: vi.fn() },
    })
    const hook = name === 'useSubmitAnswer' ? context[name](go, 'single-answer', 'q') : context[name](go, 'q')
    const pending = hook.submit('draft', { deadline: true })
    cleanups.forEach(cleanup => cleanup?.())
    finish({ error: null }); await pending
    expect(go).not.toHaveBeenCalled()
  })

  it.each(['-14', '−14', '﹣14', '－14'])('F24 never grades negative %s as positive 14', answer => {
    const question = { question_type: 'single-answer', correct_answer: '14', options: null, points_max: 1 }
    expect(buildSubmissionGrading(question, answer).items[0].status).not.toBe('correct')
    expect(buildSubmissionGrading({ ...question, correct_answer: '-14' }, answer).items[0].status).toBe('correct')
  })

  it.each([['AC/DC', 'AC'], ['Truth or Dare', 'Truth'], ['1/2', '1']])('F25 preserves literal answer %s', (answer, fragment) => {
    const question = { question_type: 'single-answer', correct_answer: answer, options: null, points_max: 1 }
    expect(buildSubmissionGrading(question, fragment).items[0].status).not.toBe('correct')
    expect(buildSubmissionGrading(question, answer).items[0].status).toBe('correct')
  })

  it('F26 reserves later exact answers before matching an earlier typo', () => {
    const result = buildSubmissionGrading({ question_type: 'multi-answer', correct_answer: ['Canada', 'France'], points_max: 2, options: null }, '["Cannada","Canada"]')
    expect(result.items[1]).toMatchObject({ submitted: 'Canada', expected: 'Canada', status: 'correct' })
    expect(result.items[0].expected).toBeUndefined()
    expect(result.missing).toEqual(['France'])
  })

  it('F39 can submit the literal word null', () => {
    expect(buildSubmissionGrading({ question_type: 'single-answer', correct_answer: 'null', points_max: 1, options: null }, 'null').items[0]).toMatchObject({ submitted: 'null', status: 'correct' })
  })

  it('F33 honors all-or-nothing multipart scoring', () => {
    const question = { question_type: 'multi-part', correct_answer: ['Canada', 'France'], points_max: 1, options: null }
    expect(scoreSubmission(question, { answer_text: '["Canada", "Spain"]', grading_json: null }).points).toBe(0)
    expect(scoreSubmission(question, { answer_text: '["Canada", "France"]', grading_json: null }).points).toBe(1)
  })

  it('F9 does not reuse a round number after deleting a middle template round', () => {
    let draft = { rounds: [{ number: 1 }, { number: 3 }] }
    const context = handler(host, 'addRound', { setDraft: (update: (value: typeof draft) => typeof draft) => { draft = update(draft) } })
    context.addRound()
    expect(draft.rounds.map(round => round.number)).toEqual([1, 3, 4])
  })

  it('D8 moves any template item between rounds, including an empty round', () => {
    let draft = {
      rounds: [{ number: 1, title: 'First' }, { number: 2, title: 'Second' }, { number: 3, title: 'Empty' }],
      questions: [{ question_key: 'q', round_number: 1, round_title: 'First', item_position: 1 }],
      contentScreens: [{ screen_key: 's', round_number: 2, round_title: 'Second', item_position: 2 }],
      showGames: [{ show_game_key: 'g', round_number: 2, round_title: 'Second', item_position: 3 }],
    }
    const context = handler(host, 'moveItemBefore', { setDraft: (update: (value: typeof draft) => typeof draft) => { draft = update(draft) } })
    context.moveItemBefore(2, 'question:q', 'game:g')
    expect(draft.questions[0]).toMatchObject({ round_number: 2, round_title: 'Second', item_position: 2 })
    context.moveItemBefore(3, 'content:s', null)
    expect(draft.contentScreens[0]).toMatchObject({ round_number: 3, round_title: 'Empty', item_position: 3 })
    expect(new Set([...draft.questions, ...draft.contentScreens, ...draft.showGames].map(item => item.item_position)).size).toBe(3)
  })

  it('F27 ignores the slower earlier admin editor request', async () => {
    const resolve: ((value: unknown) => void)[] = []
    const setEditing = vi.fn()
    const context = handler('components/host/QuestionsArea.tsx', 'openEditor', {
      adminMode: true, editorRequestRef: { current: 0 }, setEditing, setLoadError: vi.fn(),
      supabase: { from: () => ({ select() { return this }, eq() { return this }, order: () => new Promise(done => resolve.push(done)) }) },
    })
    const first = context.openEditor({ id: 'a', mechanic: 'multi-part', correct_answer: ['A'] })
    const second = context.openEditor({ id: 'b', mechanic: 'multi-part', correct_answer: ['B'] })
    resolve[1]({ data: [{ id: 'part-b', position: 1 }], error: null }); await second
    resolve[0]({ data: [{ id: 'part-a', position: 1 }], error: null }); await first
    expect(setEditing).toHaveBeenCalledTimes(1)
    expect(setEditing.mock.calls[0][0].id).toBe('b')
  })

  it('A1 keeps private visibility on a failed settings read', async () => {
    const set = vi.fn()
    const context = handler(player, 'useLeaderboardVisibility', {
      leaderboardVisibilityFromSettings,
      useState: () => ['host', set], useEffect: (effect: () => void) => effect(),
      localStorage: { getItem: () => 'game' }, crypto: { randomUUID: () => 'channel' },
      supabase: { channel, from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: new Error('offline') }) }) },
    })
    context.useLeaderboardVisibility()
    await flush()
    expect(set).not.toHaveBeenCalled()
  })

  it.each(['open-old-core', 'open-q-bonus', 'speed-old-core', 'speed-q-bonus'])('A2 ignores mismatched clock %s', key => {
    const timeout = vi.fn()
    const context = handler(player, 'useAutoSubmitPlayerDraft', {
      usePlayerAutoRunClock: () => ({ key, deadlineMs: 0, label: 'Answers close', paused: false }),
      useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effect(),
      window: { setTimeout: timeout, clearTimeout: vi.fn() },
    })
    context.useAutoSubmitPlayerDraft('draft', true, vi.fn(), 'q', 'core')
    expect(timeout).not.toHaveBeenCalled()
  })

  it('A6 discards an older leaderboard response arriving last', async () => {
    const resolves: ((value: unknown) => void)[] = []
    const set = vi.fn()
    const context = handler(player, 'useLiveLeaderboard', {
      useState: (value: unknown) => [value, set], useEffect: (effect: () => void) => effect(),
      localStorage: { getItem: () => 'game' }, crypto: { randomUUID: () => 'channel' },
      supabase: {
        from: () => ({ select() { return this }, eq() { return this }, order: () => new Promise(resolve => resolves.push(resolve)) }),
        channel: () => ({ on() { return this }, subscribe(callback: (status: string) => void) { callback('SUBSCRIBED'); return this } }),
      },
    })
    context.useLiveLeaderboard()
    resolves[1]({ data: [{ id: 't', score: 200 }], error: null }); await flush()
    resolves[0]({ data: [{ id: 't', score: 100 }], error: null }); await flush()
    expect(set.mock.calls.filter(([value]) => Array.isArray(value))).toEqual([[[{ id: 't', score: 200 }]]])
  })

  it('B1 does not crash or silently score malformed historical multipart answers', () => {
    const result = scoreSubmission({ question_type: 'multi-part', correct_answer: ['Paris', ''], options: [], points_max: 2 }, { answer_text: '["Paris", ""]', grading_json: null })
    expect(result.points).toBe(1)
    expect(result.grading.items[1].status).toBe('review')
  })

  it('B9 preserves folder interaction when local storage throws', () => {
    let collapsed = new Set<string>()
    const context = handler(host, 'toggleFolder', {
      setCollapsedFolderIds: (update: (value: Set<string>) => Set<string>) => { collapsed = update(collapsed) },
      COLLAPSED_QUIZ_FOLDERS_KEY: 'folders', localStorage: { setItem: () => { throw new Error('QuotaExceededError') } },
    })
    expect(() => context.toggleFolder('f')).not.toThrow()
    expect(collapsed.has('f')).toBe(true)
    context.toggleFolder('f')
    expect(collapsed.has('f')).toBe(false)
  })

  it.each(['−12', '﹣12', '－12'])('D10 preserves negative numeric guess %s', value => {
    expect(parseNumericResponseInput(value)).toBe(-12)
    expect(formatNumericResponseInput(value)).toBe('-12')
  })
  it.each(['12x', '1.2.3', '12-3', '--12', '1e3'])('D10 rejects malformed numeric guess %s', value => {
    expect(parseNumericResponseInput(value)).toBeNull()
  })

  it('E6 reserves topic-specific supply before mixed rounds, preserving display order', () => {
    const questions = ['Music', 'Music', 'Science', 'Science'].map((category, i) => ({ id: String(i), category, difficulty: 'Easy' }))
    const options = { questions, questionCount: 4, roundTopics: ['General Knowledge', 'Music'], difficulties: ['Easy'], tiebreakers: [], tiebreakerCount: 0, random: () => 0.999 }
    const plan = buildAutoQuizPlan(options)
    expect(plan.rounds.map(round => round.title)).toEqual(['General Knowledge', 'Music'])
    expect(plan.rounds[0].questions.every(q => q.category === 'Science')).toBe(true)
    expect(plan.rounds[1].questions.every(q => q.category === 'Music')).toBe(true)
    expect(getAutoBuildAvailability({ ...options, questions: questions.slice(0, 2) }).canBuild).toBe(false)
  })
})

describe('audit authoring and retry boundaries', () => {
  it.each([
    ['components/host/BuilderQuestionPicker.tsx', 'selectRandomQuestion'],
    ['components/host/BuilderTiebreakerPicker.tsx', 'selectRandomTiebreaker'],
  ])('F14 ignores a completed random request after closing %s', async (file, name) => {
    let complete!: (value: unknown) => void
    const activeRef = { current: true }, onSelect = vi.fn()
    const query = { select() { return this }, eq() { return this }, then(resolve: (value: unknown) => void) { complete = resolve } }
    const context = handler(file, name, { randomLoading: false, activeRef, onSelect, setError: vi.fn(), setRandomLoading: vi.fn(), supabase: { from: () => query } })
    const result = context[name](); await flush(); activeRef.current = false
    complete({ count: 1, error: null }); await result
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('F16 retries a permanent QR lookup after a thrown network failure', async () => {
    vi.useFakeTimers()
    try {
      const rpc = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: [{ game_code: '123456' }], error: null })
      const replace = vi.fn()
      const context = handler('components/PermanentHostJoin.tsx', 'resolveGame', {
        active: true, resolvedSlug: 'venue', retryTimer: null, setTimeout, clearTimeout,
        supabase: { rpc }, setState: vi.fn(), setMessage: vi.fn(),
        window: { location: { origin: 'https://example.test', replace } }, buildGameJoinUrl: (_: string, code: string) => code,
      })
      await context.resolveGame(); await vi.advanceTimersByTimeAsync(10000)
      expect(rpc).toHaveBeenCalledTimes(2); expect(replace).toHaveBeenCalledWith('123456')
    } finally { vi.useRealTimers() }
  })
  it('F28 retains explicit personal ranker points while library rankers default to one', () => {
    const context = handler(host, 'sourceToBuilderQuestion', { crypto: { randomUUID: () => 'uuid' }, effectiveTriviaDifficulty: () => 'Easy', questionTypeLabel: (v: string) => v })
    const source = { category_names: [], tag_names: [], question_type: 'ranking', correct_answer: ['A', 'B', 'C'], scoring_mode: 'per-item', origin: 'user' }
    expect(context.sourceToBuilderQuestion(source).pointsMax).toBe(3)
    expect(context.sourceToBuilderQuestion({ ...source, origin: 'platform' }).pointsMax).toBe(1)
    expect(context.sourceToBuilderQuestion({ ...source, scoring_mode: 'all-or-nothing' }).pointsMax).toBe(1)
  })
  it('F37/B8 rejects a one-item or duplicate ranker and B1 requires each multipart clue', () => {
    const context = handler('components/host/QuestionsArea.tsx', 'validateDraft', {})
    const base = { prompt: 'Rank these', questionType: 'ranking', answers: ['Earth'], audienceScope: 'global' }
    expect(context.validateDraft(base)).toMatch(/at least two/)
    expect(context.validateDraft({ ...base, answers: ['Earth', ' earth '] })).toMatch(/different/)
    expect(context.validateDraft({ ...base, answers: ['Earth', 'Mars'] })).toBeNull()
    expect(context.validateDraft({ ...base, questionType: 'multi-part', clues: [] })).toMatch(/clue/)
  })
  it('F34 prevents overlapping folder mutations and preserves the old folder on failure', async () => {
    const from = vi.fn(), setQuizzes = vi.fn(), setLoadError = vi.fn(), folderOrderBusyRef = { current: true }
    const query = { update() { return this }, eq() { return this }, select() { return this }, single: async () => ({ error: { message: 'folder removed' }, data: null }) }
    from.mockReturnValue(query)
    const context = handler(host, 'moveQuizToFolder', { quizzes: [{ id: 'q', folder_id: 'old' }], movingQuizId: null, folderBusy: false, folderOrderBusyRef, setMovingQuizId: vi.fn(), setLoadError, setQuizzes, supabase: { from } })
    await context.moveQuizToFolder('q', 'new'); expect(from).not.toHaveBeenCalled()
    folderOrderBusyRef.current = false
    await context.moveQuizToFolder('q', 'new')
    expect(setQuizzes).not.toHaveBeenCalled(); expect(setLoadError).toHaveBeenLastCalledWith(expect.stringContaining('destination may have been removed'))
    expect(folderOrderBusyRef.current).toBe(false)
  })
  it('D9 retains the open template and its draft when saving fails', async () => {
    const setEditingTemplate = vi.fn(), setTemplateDraft = vi.fn(), setError = vi.fn()
    const query = { update() { return this }, eq() { return this }, select() { return this }, single: async () => ({ error: { message: 'offline' }, data: null }) }
    const context = handler(host, 'saveTemplateDraft', { editingTemplate: { id: 't' }, busyId: null, normalizedTemplateStructure: (v: unknown) => v, estimatedQuizMinutes: () => 1, setBusyId: vi.fn(), setError, setEditingTemplate, setTemplateDraft, supabase: { from: () => query } })
    await context.saveTemplateDraft({ questions: [], showGames: [] })
    expect(setEditingTemplate).not.toHaveBeenCalled(); expect(setTemplateDraft).not.toHaveBeenCalled()
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('Could not save'))
  })
})

describe('editor and navigation safeguards', () => {
  it('F32 resets an incompatible answer key when switching to multiple choice', () => {
    const setCorrectChoice = vi.fn()
    const context = handler(host, 'applyTypeChange', { qtype: 'single', setQtype: vi.fn(), setCorrectChoice, choiceOptions: [{ key: 'A' }], setScoring: vi.fn() })
    context.applyTypeChange('multiple-choice'); expect(setCorrectChoice).toHaveBeenCalledWith('A')
  })
  it('F36 prevents backdrop dismissal of unsaved or currently-saving template edits', () => {
    const onClose = vi.fn(), confirm = vi.fn().mockReturnValue(false)
    const context = handler(host, 'requestClose', { saving: false, draft: { title: 'New' }, structure: { title: 'Old' }, window: { confirm }, onClose })
    context.requestClose(); expect(onClose).not.toHaveBeenCalled()
    confirm.mockReturnValue(true); context.requestClose(); expect(onClose).toHaveBeenCalledTimes(1)
    context.saving = true; context.requestClose(); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('C9 refuses to leave the round while answer loading is incomplete', async () => {
    const updateLiveGame = vi.fn()
    const context = handler(host, 'startNextRound', { roundDataReady: false, roundFinalized: true, busyRef: { current: false }, updateLiveGame })
    await context.startNextRound(); expect(updateLiveGame).not.toHaveBeenCalled()
  })
  it('F3 ignores stale initial hydration after a newer live event', async () => {
    let finish!: (value: unknown) => void, liveCallback!: (payload: unknown) => void
    const setScreen = vi.fn(), cleanups: (() => void)[] = []
    const query = { select() { return this }, eq() { return this }, maybeSingle: () => new Promise(resolve => { finish = resolve }) }
    const subscription = { on(_event: unknown, filter: { table: string }, callback: (value: unknown) => void) { if (filter.table === 'games') liveCallback = callback; return this }, subscribe() { return this } }
    const context = handler(player, 'useLivePlayerSync', {
      useEffect: (effect: () => (() => void)) => cleanups.push(effect()), localStorage: { getItem: () => 'id' }, navigator: { onLine: true }, crypto: { randomUUID: () => 'id' },
      supabase: { from: () => query, channel: () => subscription, removeChannel: vi.fn() },
      resolveLivePlayerScreen: async (_game: string, _team: string, state: { current_screen: string }) => state.current_screen,
      window: { setTimeout, clearTimeout, setInterval: vi.fn(), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
      document: { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' },
    })
    context.useLivePlayerSync('single-answer', setScreen)
    liveCallback({ new: { current_screen: 'final-result' } }); await flush()
    finish({ data: { current_screen: 'single-answer' }, error: null }); await flush()
    expect(setScreen).toHaveBeenCalledWith('final-result'); expect(setScreen).not.toHaveBeenCalledWith('single-answer')
    cleanups.forEach(cleanup => cleanup())
  })
})
