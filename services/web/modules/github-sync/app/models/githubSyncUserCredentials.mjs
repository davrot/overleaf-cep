import mongoose from "../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

export const GitHubSyncUserCredentialsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    github: { type: String, required: true },
    serverType: { type: String, default: 'github' },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { collection: 'githubSyncUserCredentials', minimize: false }
)

export const GitHubSyncUserCredentials = mongoose.model(
  'GitHubSyncUserCredentials',
  GitHubSyncUserCredentialsSchema,
)
