#include <avr/wdt.h>
#include "Display.h"
#include <ThreadController.h>
#include "JoystickThread.h"
#include "DhtThread.h"
#include "Button.h"
#include "LedThread.h"
#include "ServiceMenu.h"
#include "ProductCatalog.h"
#include "StartupMode.h"
#include "UltrasonicSensor.h"
#include "ServiceMode.h"
#include "AdminMode.h"

enum class Mode : byte { Startup, Service, Admin };

// pines LCD
const byte LcdRs = 5;
const byte LcdE = 6;
const byte LcdD4 = 7;
const byte LcdD5 = 8;
const byte LcdD6 = 9;
const byte LcdD7 = 10;

// pines sensor humedad y temperatura
const byte DhtPin = 4;
LiquidCrystal lcd(LcdRs, LcdE, LcdD4, LcdD5, LcdD6, LcdD7);
DHT dht(DhtPin, DHT11);

void WriteLine(byte row, const char *text) {
  lcd.setCursor(0, row);
  byte column = 0;
  while (column < 16 && text[column] != '\0') {
    lcd.write(text[column]);
    ++column;
  }
  while (column++ < 16) lcd.write(' ');
}

ThreadController tasks;
JoystickThread joystick;
DhtThread dht_task;
LedThread led1(StartupMode::Led1Pin);
LedThread led2(ServiceMode::Led2Pin);
StartupMode startup(led1);
ProductCatalog catalog;
ServiceMode service(catalog, led2);
AdminMode admin(catalog);
UltrasonicSensor ultra;
Mode mode = Mode::Startup;
Button button;

// Cambian su valor en interrupciones, volatile hace
// que se revise su valor cada vez que se utiliza
volatile bool btn_changed = false;

void ExternalButtonIsr() {
  btn_changed = true;
}

void EnterService() {
  mode = Mode::Service;
  led1.Stop();
  joystick.TakeEvent(); // Descarta eventos anteriores al reinicio.
  service.Enter();
  ultra.start();
}

void EnterAdmin() {
  mode = Mode::Admin;
  led1.SetLevel(255);
  led2.SetLevel(255);
  joystick.TakeEvent();
  dht_task.enabled = false;
  admin.Enter();
  admin.Draw(millis());
  Serial.println(F("BOTON EXTERNO: ENTRAR ADMIN"));
}

void setup() {
  MCUSR = 0;
  wdt_disable();
  Serial.begin(115200);

  led1.Begin();
  led2.Begin();
  pinMode(Button::Pin, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(Button::Pin),
                  ExternalButtonIsr, CHANGE);

  pinMode(JoystickThread::SwPin, INPUT_PULLUP);
  pinMode(UltrasonicSensor::TrigPin, OUTPUT);
  pinMode(UltrasonicSensor::EchoPin, INPUT);

  digitalWrite(UltrasonicSensor::TrigPin, LOW);

  lcd.begin(16, 2);
  dht.begin();

  randomSeed(analogRead(A0));

  joystick.enabled = false;
  dht_task.enabled = false;
  ultra.enabled = false;

  tasks.add(&joystick);
  tasks.add(&dht_task);
  tasks.add(&ultra);
  tasks.add(&led1);
  tasks.add(&led2);

  startup.Enter();

  wdt_enable(WDTO_2S);
}

void loop() {

  wdt_reset();

  // Se revisa si se ha accionado el botón: 2-3s (rst) o 5s (admin)
  const ButtonAction action = button.Update(btn_changed);

  if (action == ButtonAction::ToggleAdmin) {
    if (mode == Mode::Admin) {
      Serial.println(F("BOTON EXTERNO: SALIR ADMIN"));
      EnterService();
    } else {
      EnterAdmin();
    }

  } else if (action == ButtonAction::Reset) {
    if (mode == Mode::Service) {
      Serial.println(F("BOTON EXTERNO: RESET SERVICIO"));
      EnterService();
    }
  }

  if (mode == Mode::Admin) {
    joystick.enabled = true;
    dht_task.enabled = admin.ReadsTemperature();
    ultra.enabled = admin.ReadsDistance();
    tasks.run();

    const bool was_dist = admin.ReadsDistance();
    admin.Handle(joystick.TakeEvent());
    if (!was_dist && admin.ReadsDistance()) {
      ultra.start();
    }

    float temp, hum;
    if (dht_task.TakeReading(temp, hum)) {
      admin.ReceiveEnvironment(temp, hum);
    }

    if (admin.ReadsDistance()) {
      unsigned int dist_cm;
      if (ultra.TakeMeasurement(dist_cm)) {
        admin.ReceiveDistance(dist_cm);
      }

    }

    const unsigned long now = millis();
    admin.Update(now);
    admin.Draw(now);
    return;
  }

  if (mode == Mode::Startup) {
    tasks.run();
    if (startup.Update()) {
      EnterService();
    }
    return;
  }

  // Modo servicio:

  // Esperando al usuario:
  const bool was_waiting = service.WaitingForCustomer();
  service.Update(millis());
  if (!was_waiting && service.WaitingForCustomer()) {
    ultra.start();
  }
  joystick.enabled = service.InCatalog();
  dht_task.enabled = service.Monitoring();
  ultra.enabled = service.WaitingForCustomer();
  tasks.run();

  if (service.WaitingForCustomer()) {
    unsigned int dist_cm;

    if (ultra.TakeMeasurement(dist_cm)) {
      service.ReceiveDistance(dist_cm);
    }

  }
  
  // Temperatura y humedad 5s
  float temp, hum;
  if (dht_task.TakeReading(temp, hum)) {
    service.ReceiveEnvironment(temp, hum);
  }

  // Navegación por el catalogo
  if (service.InCatalog()) {
    service.Handle(joystick.TakeEvent());
    service.Draw();
  }

}
