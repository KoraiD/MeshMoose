/** Pre-built refine instructions, including packages with reference attachments.

Text-only snippets fill the refine textarea. Package snippets also attach a
reference mesh and/or photo (fetched from the bundled demo assets) so the Zoo
Agent can use them as visual/geometric guidance — e.g. projecting a brick
pattern onto a surface, which KCL appearance() alone cannot express.
*/

export type RefineSnippet = {
  id: string
  title: string
  prompt: string
  /** Optional attachments to load from a bundled demo folder. */
  attach?: {
    demoId: string
    photos?: string[]
    meshes?: string[]
  }
}

export const REFINE_SNIPPETS: RefineSnippet[] = [
  {
    id: 'thicken-walls',
    title: 'Thicken walls',
    prompt:
      'Increase all wall thicknesses to at least 2 mm so the part prints reliably in PLA. ' +
      'Keep outer dimensions and mounting features unchanged.',
  },
  {
    id: 'chamfer-edges',
    title: 'Chamfer outer edges',
    prompt:
      'Add a 0.5 mm chamfer on all exposed outer edges for safety and easier printing. ' +
      'Do not change holes, recesses, or mating surfaces.',
  },
  {
    id: 'split-for-printing',
    title: 'Split for support-free printing',
    prompt:
      'Split this model into the minimum number of parts that each print without supports. ' +
      'Add alignment features (dowel holes or keys) so the parts re-assemble accurately.',
  },
  {
    id: 'add-fillets',
    title: 'Fillet sharp interior corners',
    prompt:
      'Add generous fillets (2–3 mm) to sharp interior corners to reduce stress concentration. ' +
      'Preserve the overall envelope and all functional dimensions.',
  },
  {
    id: 'brick-texture',
    title: 'Brick wall texture',
    prompt:
      'Use the attached brick reference mesh and photo to recreate a realistic brick wall ' +
      'surface pattern on this model. Project raised brick courses and recessed mortar joints ' +
      'onto the main exterior faces as real parametric geometry (not just a color). ' +
      'Keep brick dimensions consistent with the reference; maintain the part\'s structural ' +
      'dimensions and any mounting features.',
    attach: {
      demoId: 'brick-wall',
      photos: ['brick_photo.jpg'],
      meshes: ['brick_segment.stl'],
    },
  },
]
