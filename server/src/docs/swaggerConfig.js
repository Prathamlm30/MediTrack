import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const string = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const dateTime = { type: 'string', format: 'date-time' };
const nullable = (schema) => ({ ...schema, nullable: true });
const enumeration = (...values) => ({ type: 'string', enum: values });
const array = (items) => ({ type: 'array', items });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const decimal = { type: 'string', description: 'Prisma Decimal serialized as a JSON string; trailing zeros are not guaranteed.', example: '1' };
const permission = enumeration('view_only', 'full_access', 'alerts_only');

// These projections follow publicUser/getUser and the route select/include clauses.
const schemas = {
  ErrorResponse: object({ error: string }),
  UserPreference: object({
    id: integer, userId: integer,
    preferredNotificationChannel: enumeration('email', 'push', 'sms', 'in_app'),
    language: string, theme: enumeration('light', 'dark'), timezone: nullable(string), updatedAt: dateTime,
  }),
  User: object({
    id: integer, fullName: string, email: string, phoneNumber: nullable(string),
    authProvider: enumeration('local', 'google'), googleId: nullable(string),
    dateOfBirth: nullable(dateTime), gender: nullable(string), profilePictureUrl: nullable(string),
    address: nullable(string), timezone: nullable(string), emailVerified: boolean, isActive: boolean,
    createdAt: dateTime, updatedAt: dateTime, lastLoginAt: nullable(dateTime),
    preferences: {}, hasPassword: boolean,
  }),
  Identity: object({ id: integer, fullName: string, email: string }),
  PatientIdentity: object({ id: integer, fullName: string }),
  CaregiverPatientLink: object({
    id: integer, patientId: integer, caregiverId: integer, relationshipType: string,
    permissionLevel: permission, status: enumeration('pending', 'active', 'revoked', 'expired'),
    invitedByUserId: nullable(integer), linkedAt: nullable(dateTime), revokedAt: nullable(dateTime),
    createdAt: dateTime, patient: ref('Identity'), caregiver: ref('Identity'),
    perspective: enumeration('patient', 'caregiver'),
  }),
  Invitation: object({
    id: integer, inviterUserId: integer, inviteeEmail: string, relationshipType: string,
    proposedRole: enumeration('patient', 'caregiver'), status: enumeration('sent', 'accepted', 'declined', 'expired'),
    expiresAt: dateTime, createdAt: dateTime, respondedAt: nullable(dateTime),
  }),
  InvitationPreview: object({
    relationshipType: string, proposedRole: enumeration('patient', 'caregiver'),
    inviter: ref('Identity'), expiresAt: dateTime, status: enumeration('sent'),
  }),
  TokenPair: object({
    accessToken: string, refreshToken: string, tokenType: enumeration('Bearer'), expiresIn: { type: 'integer', enum: [900] },
  }),
  Session: object({
    user: ref('User'), accessToken: string, refreshToken: string,
    tokenType: enumeration('Bearer'), expiresIn: { type: 'integer', enum: [900] },
  }),
  TodayDose: object({
    id: integer, scheduledDatetime: dateTime, actualActionDatetime: nullable(dateTime),
    status: enumeration('pending', 'taken', 'skipped', 'snoozed', 'missed'),
    schedule: object({ id: integer, doseAmount: decimal, medication: object({
      id: integer, medicineName: string,
      medicineForm: enumeration('tablet', 'capsule', 'syrup', 'liquid', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'patch', 'powder', 'spray', 'other'),
      dosageAmount: decimal, dosageUnit: string,
    }) }),
  }),
  Adherence: { ...object({
    periodType: enumeration('daily'), periodStartDate: dateTime, periodEndDate: dateTime,
    totalScheduledDoses: integer, takenCount: integer, missedCount: integer, skippedCount: integer,
    adherencePercentage: { ...decimal, example: '33.33' }, generatedAt: dateTime,
  }), nullable: true, description: 'Latest daily record by periodStartDate, generatedAt, then id descending; may cover an earlier day. Null when none exists.' },
  RefillAlert: object({
    id: integer, medicationId: integer, quantityRemaining: decimal, quantityUnit: string,
    estimatedRunoutDate: dateTime, medication: object({ id: integer, medicineName: string }),
  }),
  Dashboard: object({
    patient: ref('PatientIdentity'), permissionLevel: permission, readOnly: boolean,
    timezone: { type: 'string', description: 'Preference timezone, else profile timezone, else UTC. An invalid selected timezone falls back to UTC.' },
    generatedAt: dateTime,
    refillAlerts: { ...array(ref('RefillAlert')), description: 'Includes overdue runout dates and dates up to generatedAt + 7 days inclusive. Null runout dates are excluded. Sorted by runout date, then id.' },
    todayDoses: { ...array(ref('TodayDose')), description: 'Omitted for alerts_only; otherwise doses within the patient calendar day [start, end), ordered by scheduledDatetime then id. Both dose and medication ownership are checked.' },
    adherence: ref('Adherence'),
  }, ['patient', 'permissionLevel', 'readOnly', 'timezone', 'generatedAt', 'refillAlerts']),
  PatientDashboard: { allOf: [ref('Dashboard'), {
    type: 'object', required: ['todayDoses', 'adherence'],
    properties: { permissionLevel: enumeration('full_access'), readOnly: { type: 'boolean', enum: [false] } },
  }] },
  CaregiverDashboard: { allOf: [ref('Dashboard'), { oneOf: [
    { type: 'object', required: ['todayDoses', 'adherence'], properties: {
      permissionLevel: enumeration('view_only', 'full_access'), readOnly: { type: 'boolean', enum: [true] },
    } },
    { type: 'object', properties: { permissionLevel: enumeration('alerts_only'), readOnly: { type: 'boolean', enum: [true] } },
      not: { anyOf: [{ required: ['todayDoses'] }, { required: ['adherence'] }] } },
  ] }] },
  PatientListEntry: object({
    patient: ref('PatientIdentity'), relationshipType: string, permissionLevel: permission,
    readOnly: { type: 'boolean', enum: [true] },
  }),
};
// Inline the nullable object because OpenAPI 3.0 $ref siblings do not override nullability.
schemas.User.properties.preferences = nullable(schemas.UserPreference);
// Explicit examples avoid Swagger UI choosing the base enum's first value when
// composing allOf, which would incorrectly label a self dashboard view_only.
schemas.PatientDashboard.example = {
  patient: { id: 1, fullName: 'Example Patient' }, permissionLevel: 'full_access', readOnly: false,
  timezone: 'Asia/Kolkata', generatedAt: '2026-09-22T12:00:00.000Z',
  refillAlerts: [], todayDoses: [], adherence: null,
};
schemas.CaregiverDashboard.example = {
  ...schemas.PatientDashboard.example, permissionLevel: 'view_only', readOnly: true,
};

const errorResponse = (description, messages) => ({
  description,
  content: { 'application/json': { schema: ref('ErrorResponse'),
    examples: Object.fromEntries(messages.map((error, index) => [`error${index + 1}`, { value: { error } }])),
  } },
});

export default swaggerJsdoc({
  failOnErrors: true,
  definition: {
    openapi: '3.0.3',
    info: { title: 'MediTrack API', version,
      description: 'Current backend contract. Authorize with an access token from login or Google Sign-In. Refresh tokens go in the refresh request body. JSON bodies are limited to 32 KiB. Documentation is public for local development.' },
    servers: [{ url: 'http://localhost:3000' }],
    tags: ['Auth', 'Users', 'Relationships', 'Invitations', 'Dashboards', 'System'].map((name) => ({ name })),
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas,
      responses: {
        Unauthorized: errorResponse('Missing/malformed bearer header, invalid/expired access JWT, or missing/inactive account.', [
          'Bearer access token required.', 'Invalid or expired access token.', 'Account unavailable.',
        ]),
        ServerError: errorResponse('Unexpected database, Redis, email, configuration, or other server failure.', ['Unable to complete request. Please try again.']),
        DuplicateIdentity: errorResponse('Prisma unique constraint violation (including registration with an existing email).', ['An account with this email or Google identity already exists.']),
        PayloadTooLarge: errorResponse('JSON body exceeds the 32 KiB Express limit.', ['request entity too large']),
        UnsupportedBodyEncoding: errorResponse('Unsupported JSON charset or content encoding; the error includes the supplied charset/encoding.', [
          'unsupported charset "EXAMPLE"', 'unsupported content encoding "example"',
        ]),
      },
    },
  },
  // Absolute forward-slash paths also work when launched outside server/ on Windows.
  apis: [fileURLToPath(new URL('../routes/**/*.js', import.meta.url)).replaceAll('\\', '/'),
    fileURLToPath(new URL('../app.js', import.meta.url)).replaceAll('\\', '/')],
});
