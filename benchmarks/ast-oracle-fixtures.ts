/** Expected outcomes produced by the unchanged official BFCL Python AST checker at the recorded SHA.
 * Python-only dependency shim supplies enums and OpenAI dot-name conversion, never replaces scoring functions. */
export const AST_ORACLE_FIXTURES = [
  {
    "id": "simple_python_0",
    "kind": "valid",
    "calls": [
      {
        "name": "calculate_triangle_area",
        "arguments": {
          "base": 10,
          "height": 5,
          "unit": "units"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_0",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "calculate_triangle_area",
        "arguments": {
          "base": 10,
          "height": 5,
          "unit": "units",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_0",
    "kind": "missing_required",
    "calls": [
      {
        "name": "calculate_triangle_area",
        "arguments": {
          "height": 5,
          "unit": "units"
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_1",
    "kind": "valid",
    "calls": [
      {
        "name": "math_factorial",
        "arguments": {
          "number": 5
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_1",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "math_factorial",
        "arguments": {
          "number": 5,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_1",
    "kind": "missing_required",
    "calls": [
      {
        "name": "math_factorial",
        "arguments": {}
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_2",
    "kind": "valid",
    "calls": [
      {
        "name": "math_hypot",
        "arguments": {
          "x": 4,
          "y": 5
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_2",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "math_hypot",
        "arguments": {
          "x": 4,
          "y": 5,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_2",
    "kind": "missing_required",
    "calls": [
      {
        "name": "math_hypot",
        "arguments": {
          "y": 5
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_3",
    "kind": "valid",
    "calls": [
      {
        "name": "algebra_quadratic_roots",
        "arguments": {
          "a": 1,
          "b": -3,
          "c": 2
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_3",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "algebra_quadratic_roots",
        "arguments": {
          "a": 1,
          "b": -3,
          "c": 2,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_3",
    "kind": "missing_required",
    "calls": [
      {
        "name": "algebra_quadratic_roots",
        "arguments": {
          "b": -3,
          "c": 2
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_4",
    "kind": "valid",
    "calls": [
      {
        "name": "solve_quadratic_equation",
        "arguments": {
          "a": 2,
          "b": 6,
          "c": 5
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_4",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "solve_quadratic_equation",
        "arguments": {
          "a": 2,
          "b": 6,
          "c": 5,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_4",
    "kind": "missing_required",
    "calls": [
      {
        "name": "solve_quadratic_equation",
        "arguments": {
          "b": 6,
          "c": 5
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_5",
    "kind": "valid",
    "calls": [
      {
        "name": "solve_quadratic",
        "arguments": {
          "a": 3,
          "b": -11,
          "c": -4,
          "root_type": "all"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_5",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "solve_quadratic",
        "arguments": {
          "a": 3,
          "b": -11,
          "c": -4,
          "root_type": "all",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_5",
    "kind": "missing_required",
    "calls": [
      {
        "name": "solve_quadratic",
        "arguments": {
          "b": -11,
          "c": -4,
          "root_type": "all"
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_6",
    "kind": "valid",
    "calls": [
      {
        "name": "solve_quadratic",
        "arguments": {
          "a": 2,
          "b": 5,
          "c": 3
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_6",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "solve_quadratic",
        "arguments": {
          "a": 2,
          "b": 5,
          "c": 3,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_6",
    "kind": "missing_required",
    "calls": [
      {
        "name": "solve_quadratic",
        "arguments": {
          "b": 5,
          "c": 3
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_7",
    "kind": "valid",
    "calls": [
      {
        "name": "calculate_circumference",
        "arguments": {
          "radius": 4,
          "unit": "inches"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_7",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "calculate_circumference",
        "arguments": {
          "radius": 4,
          "unit": "inches",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_7",
    "kind": "missing_required",
    "calls": [
      {
        "name": "calculate_circumference",
        "arguments": {
          "unit": "inches"
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_8",
    "kind": "valid",
    "calls": [
      {
        "name": "geometry_area_circle",
        "arguments": {
          "radius": 10,
          "units": "meters"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_8",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "geometry_area_circle",
        "arguments": {
          "radius": 10,
          "units": "meters",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_8",
    "kind": "missing_required",
    "calls": [
      {
        "name": "geometry_area_circle",
        "arguments": {
          "units": "meters"
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_9",
    "kind": "valid",
    "calls": [
      {
        "name": "geometry_calculate_area_circle",
        "arguments": {
          "radius": 5,
          "unit": "units"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "simple_python_9",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "geometry_calculate_area_circle",
        "arguments": {
          "radius": 5,
          "unit": "units",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "simple_python_9",
    "kind": "missing_required",
    "calls": [
      {
        "name": "geometry_calculate_area_circle",
        "arguments": {
          "unit": "units"
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_0",
    "kind": "valid",
    "calls": [
      {
        "name": "triangle_properties_get",
        "arguments": {
          "side1": 5,
          "side2": 4,
          "side3": 3
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_0",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "triangle_properties_get",
        "arguments": {
          "side1": 5,
          "side2": 4,
          "side3": 3,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_0",
    "kind": "missing_required",
    "calls": [
      {
        "name": "triangle_properties_get",
        "arguments": {
          "side2": 4,
          "side3": 3
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_1",
    "kind": "valid",
    "calls": [
      {
        "name": "math_triangle_area_heron",
        "arguments": {
          "side1": 3,
          "side2": 4,
          "side3": 5
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_1",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "math_triangle_area_heron",
        "arguments": {
          "side1": 3,
          "side2": 4,
          "side3": 5,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_1",
    "kind": "missing_required",
    "calls": [
      {
        "name": "math_triangle_area_heron",
        "arguments": {
          "side2": 4,
          "side3": 5
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_2",
    "kind": "valid",
    "calls": [
      {
        "name": "country_info_capital",
        "arguments": {
          "country": "Brazil"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_2",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "country_info_capital",
        "arguments": {
          "country": "Brazil",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_2",
    "kind": "missing_required",
    "calls": [
      {
        "name": "country_info_capital",
        "arguments": {}
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_3",
    "kind": "valid",
    "calls": [
      {
        "name": "EuclideanDistance_calculate",
        "arguments": {
          "pointA": [
            3,
            4
          ],
          "pointB": [
            1,
            2
          ]
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_3",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "EuclideanDistance_calculate",
        "arguments": {
          "pointA": [
            3,
            4
          ],
          "pointB": [
            1,
            2
          ],
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_3",
    "kind": "missing_required",
    "calls": [
      {
        "name": "EuclideanDistance_calculate",
        "arguments": {
          "pointB": [
            1,
            2
          ]
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_4",
    "kind": "valid",
    "calls": [
      {
        "name": "kinematics_calculate_displacement",
        "arguments": {
          "initial_speed": 20,
          "acceleration": 10,
          "time": 5
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_4",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "kinematics_calculate_displacement",
        "arguments": {
          "initial_speed": 20,
          "acceleration": 10,
          "time": 5,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_4",
    "kind": "missing_required",
    "calls": [
      {
        "name": "kinematics_calculate_displacement",
        "arguments": {
          "acceleration": 10,
          "time": 5
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_5",
    "kind": "valid",
    "calls": [
      {
        "name": "weather_get_by_coordinates_date",
        "arguments": {
          "coordinates": [
            46.603354,
            1.888334
          ],
          "date": "2019-12-13"
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_5",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "weather_get_by_coordinates_date",
        "arguments": {
          "coordinates": [
            46.603354,
            1.888334
          ],
          "date": "2019-12-13",
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_5",
    "kind": "missing_required",
    "calls": [
      {
        "name": "weather_get_by_coordinates_date",
        "arguments": {
          "date": "2019-12-13"
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_6",
    "kind": "valid",
    "calls": [
      {
        "name": "capacitance_calculator_calculate",
        "arguments": {
          "A": 10,
          "d": 0.01,
          "K": 1.0
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_6",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "capacitance_calculator_calculate",
        "arguments": {
          "A": 10,
          "d": 0.01,
          "K": 1.0,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_6",
    "kind": "missing_required",
    "calls": [
      {
        "name": "capacitance_calculator_calculate",
        "arguments": {
          "d": 0.01,
          "K": 1.0
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_7",
    "kind": "valid",
    "calls": [
      {
        "name": "wildlife_population_assess_growth",
        "arguments": {
          "species": "deer",
          "location": "Washington state",
          "duration": 10
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_7",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "wildlife_population_assess_growth",
        "arguments": {
          "species": "deer",
          "location": "Washington state",
          "duration": 10,
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_7",
    "kind": "missing_required",
    "calls": [
      {
        "name": "wildlife_population_assess_growth",
        "arguments": {
          "location": "Washington state",
          "duration": 10
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_8",
    "kind": "valid",
    "calls": [
      {
        "name": "realestate_find_properties",
        "arguments": {
          "location": "SD",
          "propertyType": "villa",
          "bedrooms": 3,
          "budget": {
            "min": 300000,
            "max": 400000
          }
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_8",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "realestate_find_properties",
        "arguments": {
          "location": "SD",
          "propertyType": "villa",
          "bedrooms": 3,
          "budget": {
            "min": 300000,
            "max": 400000
          },
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_8",
    "kind": "missing_required",
    "calls": [
      {
        "name": "realestate_find_properties",
        "arguments": {
          "propertyType": "villa",
          "bedrooms": 3,
          "budget": {
            "min": 300000,
            "max": 400000
          }
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_9",
    "kind": "valid",
    "calls": [
      {
        "name": "calculate_average",
        "arguments": {
          "gradeDict": {
            "math": 90,
            "science": 75,
            "history": 82,
            "music": 89
          }
        }
      }
    ],
    "passed": true
  },
  {
    "id": "multiple_9",
    "kind": "extra_parameter",
    "calls": [
      {
        "name": "calculate_average",
        "arguments": {
          "gradeDict": {
            "math": 90,
            "science": 75,
            "history": 82,
            "music": 89
          },
          "_unexpected": true
        }
      }
    ],
    "passed": false
  },
  {
    "id": "multiple_9",
    "kind": "missing_required",
    "calls": [
      {
        "name": "calculate_average",
        "arguments": {}
      }
    ],
    "passed": false
  }
];
