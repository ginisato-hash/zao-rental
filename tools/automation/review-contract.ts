// One static review invocation may use up to three turns, including structured-output formatting.
// Independent review invocations remain limited to initial + two repairs by the controller journal.
export const REVIEW_MAX_TURNS = 3;
