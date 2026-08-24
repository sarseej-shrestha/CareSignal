(function () {
  "use strict";

  var STAGES = [
    "stage-landing",
    "stage-patient",
    "stage-detection",
    "stage-triage",
    "stage-context",
    "stage-soap",
    "stage-caregiver",
    "stage-forecast",
    "stage-summary",
  ];

  // Maps each content stage to a position on the 4-step header (Patient /
  // Detection / Triage / Intervention). Everything from "review patient"
  // onward is the Intervention step, matching how the real product treats
  // clinical note, caregiver signal, and forecast as one care-team phase.
  var STEP_FOR_STAGE = {
    "stage-patient": 0,
    "stage-detection": 1,
    "stage-triage": 2,
    "stage-context": 3,
    "stage-soap": 3,
    "stage-caregiver": 3,
    "stage-forecast": 3,
    "stage-summary": 3,
  };

  var el = {};
  STAGES.forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  var stepper = document.getElementById("stepper");
  var stepItems = stepper.querySelectorAll("li");

  function showStage(id) {
    STAGES.forEach(function (stageId) {
      el[stageId].hidden = stageId !== id;
    });
    if (id === "stage-landing") {
      stepper.hidden = true;
    } else {
      stepper.hidden = false;
      var stepIndex = STEP_FOR_STAGE[id];
      stepItems.forEach(function (li) {
        var i = Number(li.getAttribute("data-step"));
        li.classList.toggle("step-done", i < stepIndex);
        li.classList.toggle("step-active", i === stepIndex);
      });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fillList(ulEl, items) {
    ulEl.innerHTML = "";
    items.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      ulEl.appendChild(li);
    });
  }

  // ---- Stage: landing ----
  document.getElementById("btn-start").addEventListener("click", function () {
    showStage("stage-patient");
  });

  // ---- Stage: patient ----
  var bubblePatient = document.getElementById("bubble-patient");
  bubblePatient.textContent = DEMO_DATA.patient.message;

  document.getElementById("btn-send-patient").addEventListener("click", function (evt) {
    evt.target.disabled = true;
    bubblePatient.classList.remove("bubble-pending");
    window.setTimeout(function () {
      showStage("stage-detection");
      runDetection();
    }, 450);
  });

  // ---- Stage: detection ----
  var detectionLoading = document.getElementById("detection-loading");
  var detectionResult = document.getElementById("detection-result");

  function runDetection() {
    detectionLoading.hidden = false;
    detectionResult.hidden = true;
    window.setTimeout(function () {
      fillList(document.getElementById("symptom-list"), DEMO_DATA.symptomsDetected);
      detectionLoading.hidden = true;
      detectionResult.hidden = false;
    }, 900);
  }

  document.getElementById("btn-to-triage").addEventListener("click", function () {
    showStage("stage-triage");
    renderTriage();
  });

  // ---- Stage: triage ----
  function renderTriage() {
    var badge = document.getElementById("risk-badge");
    badge.textContent = "High risk  p=" + DEMO_DATA.risk.score.toFixed(2);
    badge.className = "badge badge-red";
    fillList(document.getElementById("reasons-list"), DEMO_DATA.risk.reasons);
    document.getElementById("divergence-note").textContent =
      "Hard clinical rules on their own would only reach " +
      DEMO_DATA.risk.rulesOnlyLevel +
      " here. No fever, no single reading past a hard threshold. The trained model reads the trend across her last several check-ins and pushes this to " +
      DEMO_DATA.risk.level +
      " instead. That escalation only ever goes up, never down, over what the rules alone would say.";
  }

  document.getElementById("btn-review-patient").addEventListener("click", function () {
    showStage("stage-context");
  });

  // ---- Stage: context ----
  document.getElementById("btn-to-soap").addEventListener("click", function () {
    showStage("stage-soap");
  });

  // ---- Stage: soap ----
  var soapLoading = document.getElementById("soap-loading");
  var soapResult = document.getElementById("soap-result");
  var btnGenSoap = document.getElementById("btn-gen-soap");
  var btnToCaregiver = document.getElementById("btn-to-caregiver");

  btnGenSoap.addEventListener("click", function () {
    btnGenSoap.disabled = true;
    soapLoading.hidden = false;
    window.setTimeout(function () {
      document.getElementById("soap-s").textContent = DEMO_DATA.soapNote.subjective;
      document.getElementById("soap-o").textContent = DEMO_DATA.soapNote.objective;
      document.getElementById("soap-a").textContent = DEMO_DATA.soapNote.assessment;
      document.getElementById("soap-p").textContent = DEMO_DATA.soapNote.plan;
      soapLoading.hidden = true;
      soapResult.hidden = false;
      btnGenSoap.hidden = true;
      btnToCaregiver.hidden = false;
    }, 1100);
  });

  btnToCaregiver.addEventListener("click", function () {
    showStage("stage-caregiver");
  });

  // ---- Stage: caregiver ----
  document.querySelector("#phone-caregiver .bubble-history span:first-child").textContent =
    DEMO_DATA.caregiver.earlierMessage;
  var bubbleCaregiver = document.getElementById("bubble-caregiver");
  bubbleCaregiver.textContent = DEMO_DATA.caregiver.finalMessage;

  document.getElementById("btn-send-caregiver").addEventListener("click", function (evt) {
    evt.target.disabled = true;
    bubbleCaregiver.classList.remove("bubble-pending");
    window.setTimeout(function () {
      fillList(document.getElementById("caregiver-reasons"), DEMO_DATA.caregiver.reasons);
      document.getElementById("caregiver-result").hidden = false;
    }, 500);
  });

  document.getElementById("btn-to-forecast").addEventListener("click", function () {
    showStage("stage-forecast");
    renderForecast();
  });

  // ---- Stage: forecast ----
  function renderForecast() {
    var pct = Math.round(DEMO_DATA.hospitalization.score * 100);
    var path = document.getElementById("forecast-path");
    var point = document.getElementById("forecast-point");
    var valueLabel = document.getElementById("forecast-value");

    // A simple rising trajectory ending at the real score, drawn as an
    // inline SVG path so there's no charting library dependency.
    var xs = [10, 90, 170, 250];
    var ys = [58, 52, 40, 70 - pct * 0.55];
    var d = "M " + xs[0] + " " + ys[0];
    for (var i = 1; i < xs.length; i++) d += " L " + xs[i] + " " + ys[i];
    path.setAttribute("d", d);
    point.setAttribute("cx", xs[xs.length - 1]);
    point.setAttribute("cy", ys[ys.length - 1]);
    valueLabel.textContent = pct + "%";

    var titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titleEl.textContent = pct + "% forecasted chance of hospitalization within 7 days";
    point.innerHTML = "";
    point.appendChild(titleEl);

    fillList(document.getElementById("forecast-factors"), DEMO_DATA.hospitalization.factors);
  }

  document.getElementById("btn-to-summary").addEventListener("click", function () {
    showStage("stage-summary");
    document.getElementById("fhir-json").textContent = JSON.stringify(DEMO_DATA.fhir, null, 2);
  });

  // ---- Stage: summary / restart ----
  document.getElementById("btn-restart").addEventListener("click", function () {
    document.getElementById("btn-send-patient").disabled = false;
    bubblePatient.classList.add("bubble-pending");

    detectionLoading.hidden = true;
    detectionResult.hidden = true;

    btnGenSoap.disabled = false;
    btnGenSoap.hidden = false;
    btnToCaregiver.hidden = true;
    soapResult.hidden = true;

    document.getElementById("btn-send-caregiver").disabled = false;
    bubbleCaregiver.classList.add("bubble-pending");
    document.getElementById("caregiver-result").hidden = true;

    showStage("stage-landing");
  });
})();
