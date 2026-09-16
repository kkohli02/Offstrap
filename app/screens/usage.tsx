import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function UsageChartScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Usage Charts</Text>

      {/* Battery Chart Placeholder */}
      <Text style={styles.sectionTitle}>Battery Usage</Text>
      <View style={styles.placeholderBox}>
        <Text style={styles.placeholderText}>[ Battery Chart Placeholder ]</Text>
      </View>

      {/* Zone-wise Travel Placeholder */}
      <Text style={styles.sectionTitle}>Zone-wise Travel</Text>
      <View style={styles.placeholderBox}>
        <Text style={styles.placeholderText}>[ Mini Map Placeholder ]</Text>
      </View>

      {/* Lock/Unlock Count */}
      <Text style={styles.sectionTitle}>Lock/Unlock Stats</Text>
      <View style={styles.countContainer}>
        <View style={styles.countCard}>
          <Text style={styles.countValue}>12</Text>
          <Text style={styles.countLabel}>Interaction Count</Text>
        </View>
        <View style={styles.countCard}>
          <Text style={styles.countValue}>15</Text>
          <Text style={styles.countLabel}>Unlock Count</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    flex: 1,
    padding: 16,
  },
  heading: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    color: '#ffffffff',
    fontWeight: '600',
    marginBottom: 10,
    marginTop: 20,
  },
  placeholderBox: {
    backgroundColor: '#111',
    borderRadius: 10,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#666',
    fontSize: 14,
  },
  countContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  countCard: {
    width: '48%',
    borderRadius: 10,
    backgroundColor: '#1c1c1c',
    padding: 20,
    alignItems: 'center',
  },
  countValue: {
    color: '#ffffffff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  countLabel: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 6,
  },
});
