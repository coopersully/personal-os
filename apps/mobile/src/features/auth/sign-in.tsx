import { ApiClientError } from "@personal-os/api-client";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { toast } from "sonner-native";
import { useTheme } from "../../theme";
import { useAuth } from "./context";

export function SignIn() {
  const theme = useTheme();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (recovery: boolean) => {
    if (busy) return;
    if (!email.trim() || (!recovery && !password)) {
      toast.error("Enter your email and password.");
      return;
    }
    setBusy(true);
    const id = toast.loading(recovery ? "Sending recovery email…" : "Signing in…");
    try {
      if (recovery) {
        await session.recover(email.trim());
        toast.success("If an account exists, a recovery email is on its way.", { id });
      } else {
        await session.login({ email: email.trim(), password });
        setPassword("");
        toast.dismiss(id);
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError && error.status === 401
          ? "Email or password is incorrect."
          : error instanceof ApiClientError && error.status === 429
            ? "Too many attempts. Please try again later."
            : "Couldn’t sign in. Check your connection and try again.";
      toast.error(recovery ? "Couldn’t send the recovery email. Please try again." : message, {
        id,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.canvas }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.container}>
        <View style={styles.form}>
          <Text accessibilityRole="header" style={[styles.brand, { color: theme.ink }]}>
            nohmi
          </Text>
          <Text style={[styles.subtitle, { color: theme.secondary }]}>Sign in to your account</Text>
          <Text style={{ color: theme.ink }}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            returnKeyType="next"
            style={[styles.input, { color: theme.ink, backgroundColor: theme.surface }]}
          />
          <Text style={{ color: theme.ink }}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void run(false)}
            style={[styles.input, { color: theme.ink, backgroundColor: theme.surface }]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void run(false)}
            style={[styles.button, { backgroundColor: theme.ink }]}
          >
            {busy ? (
              <ActivityIndicator color={theme.canvas} />
            ) : (
              <Text style={{ color: theme.canvas, fontWeight: "600", fontSize: 17 }}>Sign in</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void run(true)}
            style={styles.button}
          >
            <Text style={{ color: theme.secondary }}>Forgot password?</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
  form: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 12 },
  brand: { fontSize: 36, fontWeight: "700" },
  subtitle: { fontSize: 18, marginBottom: 24 },
  input: { height: 52, borderRadius: 14, paddingHorizontal: 16, fontSize: 17 },
  button: {
    minHeight: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
});
