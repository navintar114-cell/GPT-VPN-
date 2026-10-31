package com.gptvpn.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Navy = Color(0xFF071426)
private val Panel = Color(0xFF10263D)
private val Cyan = Color(0xFF45D6E8)
private val Muted = Color(0xFFA8BBD0)

data class Region(val name: String, val continent: String, val source: String, val status: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { GptVpnApp() }
    }
}

@Composable
fun GptVpnApp() {
    var selectedTab by remember { mutableStateOf("Home") }
    var selectedRegion by remember { mutableStateOf("Auto Select") }
    val demoRegions = listOf(
        Region("Demo — not connectable", "Development only", "SAMPLE", "NOT AVAILABLE")
    )

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Cyan,
            background = Navy,
            surface = Panel,
            onPrimary = Navy,
            onBackground = Color.White,
            onSurface = Color.White
        )
    ) {
        Scaffold(containerColor = Navy, bottomBar = {
            NavigationBar(containerColor = Panel) {
                listOf("Home", "Locations", "Privacy").forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = {},
                        label = { Text(tab) }
                    )
                }
            }
        }) { padding ->
            when (selectedTab) {
                "Locations" -> LocationsScreen(demoRegions, selectedRegion) { selectedRegion = it }
                "Privacy" -> PrivacyScreen()
                else -> HomeScreen(selectedRegion)
            }
        }
    }
}

@Composable
private fun HomeScreen(region: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(22.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(28.dp))
        Text("GPT VPN", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("GLOBAL • PRIVATE • FREE", color = Muted, fontSize = 12.sp)
        Spacer(Modifier.height(44.dp))
        Box(
            modifier = Modifier.size(190.dp).background(Panel, RoundedCornerShape(100.dp)),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("NOT CONNECTED", color = Cyan, fontWeight = FontWeight.Bold)
                Text("VPN tunnel not configured", color = Muted, fontSize = 10.sp)
            }
        }
        Spacer(Modifier.height(28.dp))
        Text("Selected location", color = Muted)
        Text(region, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {},
            enabled = false,
            modifier = Modifier.fillMaxWidth().height(54.dp),
            colors = ButtonDefaults.buttonColors(disabledContainerColor = Panel)
        ) { Text("CONNECT — NOT AVAILABLE YET", color = Muted) }
        Spacer(Modifier.height(18.dp))
        Text(
            "This preview does not route traffic. Real VPN connection will be enabled only after verified servers and WireGuard provisioning are implemented.",
            color = Muted,
            fontSize = 12.sp
        )
    }
}

@Composable
private fun LocationsScreen(
    regions: List<Region>,
    selected: String,
    onSelect: (String) -> Unit
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Locations", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Text("Only verified production nodes will be selectable.", color = Muted)
        Spacer(Modifier.height(16.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(regions) { region ->
                Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(region.name, color = Color.White, fontWeight = FontWeight.Bold)
                        Text("${region.continent} • ${region.source}", color = Muted)
                        Text(region.status, color = Cyan, fontSize = 11.sp)
                        TextButton(onClick = { onSelect(region.name) }, enabled = false) {
                            Text(if (selected == region.name) "SELECTED" else "NOT SELECTABLE")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PrivacyScreen() {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Privacy & Safety", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        listOf(
            "No browsing-history collection by design.",
            "No DNS-query or traffic-content logging by design.",
            "Private keys must remain on the device.",
            "Server providers must be verified and authorized.",
            "A functioning tunnel is not included in this preview."
        ).forEach { item ->
            Text("•  $item", color = Muted, modifier = Modifier.padding(vertical = 8.dp))
        }
    }
}
