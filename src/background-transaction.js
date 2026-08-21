/**
 * Commits one background settlement and compensates with the original save
 * when any required persistence target rejects the candidate.
 */
export async function commitBackgroundState({
  originalData,
  nextData,
  setData,
  save,
  requiredSource = null,
}) {
  setData(nextData);
  try {
    await save({ strict: true, requiredSource });
  } catch (error) {
    setData(originalData);
    try {
      await save({ strict: true, preserveTimestamp: true, requiredSource });
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}
