import { Stack } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { toast } from "sonner-native";
import { AppToaster } from "../components/app-toaster";
import { AuthProvider, useAuth } from "../features/auth/context";
import { PreviewProvider } from "../features/briefing/context";
import { NotificationProvider } from "../features/notifications/provider";
import { MobileDataProvider } from "../features/tasks/data";
import { useTheme } from "../theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NotificationProvider>
          <AuthenticatedLayout />
        </NotificationProvider>
        <AppToaster />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
function AuthenticatedLayout() {
  const t = useTheme();
  const { state, session } = useAuth();
  if (state.status === "checking" || state.status === "unavailable") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          backgroundColor: t.canvas,
        }}
      >
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: "600" }}>nohmi</Text>
        {state.status === "checking" ? (
          <ActivityIndicator accessibilityLabel="Checking your session" color={t.ink} />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void session
                .restore()
                .catch(() => toast.error("Couldn’t check your session. Please try again."))
            }
            style={{ padding: 20 }}
          >
            <Text style={{ color: t.ink }}>Retry connection</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <MobileDataProvider key={state.user?.id ?? "signed-out"}>
      <PreviewProvider>
        <Stack
          screenOptions={{
            headerTintColor: t.ink,
            statusBarStyle: t.dark ? "light" : "dark",
            headerUserInterfaceStyle: t.dark ? "dark" : "light",
            headerStyle: { backgroundColor: t.canvas },
            contentStyle: { backgroundColor: t.canvas },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          <Stack.Protected guard={state.status === "signedOut"}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={state.status === "signedIn"}>
            <Stack.Screen name="(workspaces)" options={{ headerShown: false, title: "today" }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="finance-budget-category" options={{ title: "category budget" }} />
            <Stack.Screen
              name="finance-budget-edit"
              options={{ title: "edit budget", presentation: "modal" }}
            />
            <Stack.Screen name="finance-notification" options={{ title: "Finance update" }} />
            <Stack.Screen name="finance-chat-reference" options={{ title: "Finance reference" }} />
            <Stack.Screen
              name="finance-opening-position"
              options={{ title: "Starting balances" }}
            />
            <Stack.Screen
              name="finance-historical-cleanup"
              options={{ title: "Historical cleanup" }}
            />
            <Stack.Screen name="finance-account" options={{ title: "account" }} />
            <Stack.Screen
              name="finance-transaction-edit"
              options={{ title: "edit transaction", presentation: "modal" }}
            />
            <Stack.Screen name="finance-transaction" options={{ title: "transaction" }} />
            <Stack.Screen name="task-preferences" options={{ title: "task preferences" }} />
            <Stack.Screen name="task-browser" options={{ title: "tasks" }} />
            <Stack.Screen name="task-containers" options={{ title: "tasks" }} />
            <Stack.Screen name="task-editor" options={{ title: "task", presentation: "modal" }} />
            <Stack.Screen
              name="task-container"
              options={{ title: "organize", presentation: "modal" }}
            />
            <Stack.Screen name="reminders" options={{ title: "reminders" }} />
            <Stack.Screen name="detail/[id]" options={{ title: "sample details" }} />
            <Stack.Screen
              name="profile"
              options={{ title: "preview settings", presentation: "modal" }}
            />
            <Stack.Screen
              name="monitoring"
              options={{ title: "monitoring", presentation: "modal" }}
            />
          </Stack.Protected>
        </Stack>
      </PreviewProvider>
    </MobileDataProvider>
  );
}
