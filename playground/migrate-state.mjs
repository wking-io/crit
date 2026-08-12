const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Adds identity fields introduced after the first playground Canvas format.
 * Returns the original value when it is not the known legacy shape.
 */
export const migrateLegacyPlaygroundCanvas = (value, author) => {
  if (
    !isRecord(value) ||
    value.format !== "crit-canvas" ||
    value.version !== 1 ||
    !Array.isArray(value.notes) ||
    (value.owner !== null && value.owner !== undefined)
  ) return value

  return {
    ...value,
    owner: author,
    notes: value.notes.map((note) =>
      isRecord(note) && note.author === undefined
        ? { ...note, author }
        : note
    )
  }
}
