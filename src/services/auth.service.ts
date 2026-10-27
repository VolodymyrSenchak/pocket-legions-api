import { getSupabaseClient} from "../utils/supabaseDb";
import {failure, Result, success} from "../models";
import {Session, User} from "@supabase/supabase-js";

export interface LoginCommand {
  email: string;
  password: string;
}

export interface GoogleLoginCommand {
  idToken: string;
  nonce?: string;
  accessToken?: string;
}

export interface PasswordChangeCommand {
  userId: string;
  email: string;
  currentPassword: string;
  newPassword: string;
}

export interface PasswordChangeForgottenCommand {
  userId: string;
  newPassword: string;
}

export interface PasswordResetCommand {
  email: string;
  redirectTo: string;
}

export interface AuthResult {
  user: User;
  session: Session;
}

export class AuthService {
  private readonly db = getSupabaseClient();
  private readonly adminDb = getSupabaseClient();

  async register(command: LoginCommand): Promise<Result<AuthResult>> {
    const { data, error } = await this.db.auth.signUp({
      email: command.email,
      password: command.password,
    });

    return error ? failure(error) : success(data as AuthResult);
  }

  async login(command: LoginCommand): Promise<Result<AuthResult>> {
    const { data, error } = await this.db.auth.signInWithPassword({
      email: command.email,
      password: command.password,
    });

    return error ? failure(error) : success(data);
  }

  async loginWithGoogle(command: GoogleLoginCommand): Promise<Result<AuthResult>> {
    const { data, error } = await this.db.auth.signInWithIdToken({
      provider: "google",
      token: command.idToken,
      nonce: command.nonce,
      access_token: command.accessToken,
    });

    return error ? failure(error) : success(data);
  }

  async refreshToken(refreshToken: string): Promise<Result<AuthResult>> {
    const { data, error } = await this.db.auth.refreshSession({
      refresh_token: refreshToken
    });

    return error ? failure(error) : success(data as AuthResult);
  }

  async getUser(jwt: string): Promise<Result<User>> {
    const { data, error } = await this.db.auth.getUser(jwt);

    return error ? failure(error) : success(data.user);
  }

  async resetPassword(command: PasswordResetCommand): Promise<Result<{}>> {
    const { error, data } = await this.db.auth.resetPasswordForEmail(command.email, { redirectTo: command.redirectTo });
    return error ? failure(error) : success(data);
  }

  async changePassword(command: PasswordChangeCommand): Promise<Result<{}>> {
    const { error: verifyError } = await this.db.auth.signInWithPassword({
      email: command.email,
      password: command.currentPassword,
    });

    if (verifyError) {
      return failure("Current password is incorrect", "unauthorized");
    }

    const { error, data } = await this.adminDb.auth.admin.updateUserById(command.userId, {
      password: command.newPassword,
    });

    return error ? failure(error) : success(data);
  }

  async changePasswordForgotten(command: PasswordChangeForgottenCommand): Promise<Result<{}>> {
    const { error, data } = await this.adminDb.auth.admin.updateUserById(command.userId, {
      password: command.newPassword,
    });

    return error ? failure(error) : success(data);
  }
}
