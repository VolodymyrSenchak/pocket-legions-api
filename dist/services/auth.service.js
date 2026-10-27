"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const supabaseDb_1 = require("../utils/supabaseDb");
const models_1 = require("../models");
class AuthService {
    db = (0, supabaseDb_1.getSupabaseClient)();
    adminDb = (0, supabaseDb_1.getSupabaseClient)();
    async register(command) {
        const { data, error } = await this.db.auth.signUp({
            email: command.email,
            password: command.password,
        });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
    async login(command) {
        const { data, error } = await this.db.auth.signInWithPassword({
            email: command.email,
            password: command.password,
        });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
    async loginWithGoogle(command) {
        const { data, error } = await this.db.auth.signInWithIdToken({
            provider: "google",
            token: command.idToken,
            nonce: command.nonce,
            access_token: command.accessToken,
        });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
    async refreshToken(refreshToken) {
        const { data, error } = await this.db.auth.refreshSession({
            refresh_token: refreshToken
        });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
    async getUser(jwt) {
        const { data, error } = await this.db.auth.getUser(jwt);
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data.user);
    }
    async resetPassword(command) {
        const { error, data } = await this.db.auth.resetPasswordForEmail(command.email, { redirectTo: command.redirectTo });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
    async changePassword(command) {
        const { error: verifyError } = await this.db.auth.signInWithPassword({
            email: command.email,
            password: command.currentPassword,
        });
        if (verifyError) {
            return (0, models_1.failure)("Current password is incorrect", "unauthorized");
        }
        const { error, data } = await this.adminDb.auth.admin.updateUserById(command.userId, {
            password: command.newPassword,
        });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
    async changePasswordForgotten(command) {
        const { error, data } = await this.adminDb.auth.admin.updateUserById(command.userId, {
            password: command.newPassword,
        });
        return error ? (0, models_1.failure)(error) : (0, models_1.success)(data);
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=auth.service.js.map