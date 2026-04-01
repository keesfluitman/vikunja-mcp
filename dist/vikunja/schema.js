import { z } from 'zod';
// Vikunja returns "0001-01-01T00:00:00Z" for unset dates — treat as absent
const VIKUNJA_NULL_DATE = '0001-01-01T00:00:00Z';
export const DateTimeSchema = z
    .string()
    .datetime({ offset: true })
    .optional()
    .transform(val => (val === VIKUNJA_NULL_DATE ? undefined : val));
export const HexColorSchema = z.string().max(7).startsWith('#').optional();
export const IdentifierSchema = z.string().min(0).max(10);
export const RightsSchema = z.number().int().min(0).max(2); // 0: RO, 1: RW, 2: Admin
export const RelationKindSchema = z.enum([
    'unknown',
    'subtask',
    'parenttask',
    'related',
    'duplicateof',
    'duplicates',
    'blocking',
    'blocked',
    'precedes',
    'follows',
    'copiedfrom',
    'copiedto',
]);
export const UserSchema = z.object({
    created: DateTimeSchema,
    email: z.string().optional(),
    id: z.number(),
    name: z.string().optional(),
    updated: DateTimeSchema,
    username: z.string(),
});
export const LabelSchema = z.object({
    description: z.string().optional(),
    hex_color: HexColorSchema,
    id: z.number(),
    title: z.string(),
});
// Common validation messages
export const ValidationMessages = {
    hexColor: 'Must be a valid hex color code (e.g. #FF0000)',
    identifier: 'Must be between 0 and 10 characters',
    dateTime: 'Must be a valid ISO datetime string',
    rights: 'Must be a number between 0 and 2 (0: RO, 1: RW, 2: Admin)',
};
