// logics/notifications/localNotify.ts
import { Platform } from 'react-native';
import PushNotification, { Importance } from 'react-native-push-notification';
import PushNotificationIOS from '@react-native-community/push-notification-ios';

type NotifyNowInput =
  | { title: string; body: string; tag?: string }
  | string; // for old signature support (message only)

// Call once on app start
export async function initLocalNotifications() {
  if (Platform.OS === 'android') {
    // Required: channel must exist before posting
    PushNotification.createChannel(
      {
        channelId: 'offstrap-default',
        channelName: 'OffStrap Alerts',
        channelDescription: 'General alerts from OffStrap',
        importance: Importance.HIGH,
        vibrate: true,
      },
      () => {}
    );
  }

  // Configure base callbacks (safe no-op)
  PushNotification.configure({
    onNotification: () => {},
    requestPermissions: Platform.OS === 'ios', // iOS prompt
  });
}

function normalize(input: NotifyNowInput) {
  if (typeof input === 'string') {
    return { title: 'OffStrap', body: input, tag: undefined as string | undefined };
  }
  return input;
}

export async function requestPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  const res = await PushNotificationIOS.requestPermissions({ alert: true, sound: true, badge: true });
  return !!(res && (res.alert || res.sound || res.badge));
}

export function notifyNow(input: NotifyNowInput) {
  const { title, body, tag } = normalize(input);

  if (Platform.OS === 'ios') {
    // iOS: use native API (works reliably in foreground with our AppDelegate delegate)
    PushNotificationIOS.addNotificationRequest({
      id: tag ?? `offstrap-${Date.now()}`,
      title,
      body,
      sound: 'default',
    });
    return;
  }

  // Android
  PushNotification.localNotification({
    channelId: 'offstrap-default',
    title,
    message: body,
    playSound: true,
    soundName: 'default',
    priority: 'high',
    // tag is Android-specific; keep for grouping
    tag,
  });
}

export function notifyIn(delayMs: number, title: string, message: string, id?: string) {
  if (Platform.OS === 'ios') {
    // iOS: schedule using native API
    const fireDate = new Date(Date.now() + delayMs);
    PushNotificationIOS.addNotificationRequest({
      id: id ?? `offstrap-sched-${Date.now()}`,
      title,
      body: message,
      sound: 'default',
      fireDate, // schedules
    });
    return;
  }

  // Android
  PushNotification.localNotificationSchedule({
    channelId: 'offstrap-default',
    title,
    message,
    date: new Date(Date.now() + delayMs),
    allowWhileIdle: true,
    id, // helps cancel
  });
}

export function cancelNotificationById(id: string) {
  if (!id) return;

  if (Platform.OS === 'ios') {
    PushNotificationIOS.removePendingNotificationRequests([id]);
    // Also remove delivered one if already shown
    PushNotificationIOS.removeDeliveredNotifications([id]);
    return;
  }

  // Android targeted cancel
  PushNotification.cancelLocalNotifications({ id });
}
