import { loadDatabaseEnvFile } from '../config.js';

// Integration tests read the same git-ignored credentials as the CLI scripts.
loadDatabaseEnvFile();
